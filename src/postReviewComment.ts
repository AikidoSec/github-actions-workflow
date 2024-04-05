import * as core from '@actions/core';
import * as github from '@actions/github';
import * as crypto from 'crypto';

type TFinding = { commit_id: string, path: string, line: number, start_line: number, body: string }

// This function is used to check duplicates on new scans & bypass certain edge cases.
// Commit_id was not added to the hash, because Github will only send over the comments from the current commit.
// Body was not added to the hash to avoid multiple comments on the same line.
const parseSnippetHashFromComment = (finding: any): string | undefined => {
	if (finding.path == null || finding.line == null) return undefined

	return crypto.createHash('sha256').update(`${finding.path}-${finding.line}`).digest('hex');
}

// Possible edge cases:
// - Previous finding/comment has moved location in newer commit: Github handles this and passes location within current commit.
// - New finding on the same line number as a previous finding: Github handles this as the old comment is not present in current commit.
// - The same finding (previously deleted) is now back. We detect this as a duplicate, so the old conversation is preserved.
export const postFindingsAsReviewComments = async (findings: TFinding[]): Promise<void> => {
	const githubToken = core.getInput('github-token');
	if (!githubToken || githubToken === '') {
		core.error('unable to post review comments: missing github-token input parameter');
		return;
	}

	const context = github.context;
	if (context.payload.pull_request == null) {
		core.error('unable to post review comments: action is not run in a pull request context');
		return;
	}

	const pullRequestNumber = context.payload.pull_request.number;

	const octokit = github.getOctokit(githubToken);

	const { data: reviewComments } = await octokit.rest.pulls.listReviewComments({
		owner: context.repo.owner,
		repo: context.repo.repo,
		pull_number: pullRequestNumber
	});

	// Add new review comments
	for (const finding of findings) {
		const findingId = parseSnippetHashFromComment(finding)

		if (findingId === undefined) continue;

		// Check for duplicates
		let existingFinding = undefined
		for (const comment of reviewComments) {
			const isBot = comment.user?.type === 'Bot';
			const existingCommentId = parseSnippetHashFromComment(comment)

			if (!isBot || existingCommentId === undefined || findingId != existingCommentId) continue;

			existingFinding = comment
		}
		if (typeof existingFinding !== 'undefined') {
			core.info(`Finding ${JSON.stringify(finding)} equals ${JSON.stringify(existingFinding)}`)
		}

		if (typeof existingFinding === 'undefined') {
			await octokit.rest.pulls.createReviewComment({
				...context.repo,
				pull_number: pullRequestNumber,
				commit_id: finding.commit_id,
				path: finding.path,
				body: finding.body,
				line: finding.line,
				...(finding.start_line != finding.line) && { start_line: finding.start_line }
			});
		}
	}
};
