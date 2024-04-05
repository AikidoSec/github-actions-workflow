import * as core from '@actions/core';
import * as github from '@actions/github';
import * as crypto from 'crypto';

type TFinding = { commit_id: string, path: string, line: number, start_line: number, body: string }

// This function is used to check duplicates on new scans & bypass certain edge cases.
// The app will compare a hash from an Aikido finding against a hash from a Github comment. As such, we can only use properties that live in both entities (e.g. Aikido hash_snippet can not be used).
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
		core.info('unable to post review comments: missing github-token input parameter');
		return;
	}

	const context = github.context;
	if (context.payload.pull_request == null) {
		core.info('unable to post review comments: action is not run in a pull request context');
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

		// Duplicate detection
		let existingFinding = undefined
		for (const comment of reviewComments) {
			const isBot = comment.user?.type === 'Bot';
			const existingCommentId = parseSnippetHashFromComment(comment)

			// Skip comments that generate invalid hashes
			if (existingCommentId === undefined) continue;

			// Skip comments that aren't a bot
			if (!isBot) continue;

			// Check for duplicate
			if (findingId != existingCommentId) continue;

			existingFinding = comment
		}

		if (typeof existingFinding === 'undefined') {
			try {
				await octokit.rest.pulls.createReviewComment({
					...context.repo,
					pull_number: pullRequestNumber,
					commit_id: finding.commit_id,
					path: finding.path,
					body: finding.body,
					line: finding.line,
					...(finding.start_line != finding.line) && { start_line: finding.start_line }
				});
			} catch (error) {
				if (error instanceof Error) {
					core.info(`unable to post scan status comment due to error: ${error.message}. Tried posting ${JSON.stringify(finding)}`);
				} else {
					core.info(`unable to post scan status comment due to unknown error`);
				}
			}
			
		}
	}
};
