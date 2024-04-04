import * as core from '@actions/core';
import * as github from '@actions/github';

type TFinding = { commit_id: string, path: string, line: number, start_line: number, body: string }

const parseUniqueAikidoID = (body: string): string | undefined => {
	const regex = new RegExp('.*app\.aikido\.dev\/finding\/(.*)\/.*', 'i');
	const match = regex.exec(body.toLowerCase())
	if (match == null) {
		return undefined
	}
	return match[1]
}

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

	// Delete review comments that are not in current findings
	for (const comment of reviewComments) {
		const isBot = comment.user?.type === 'Bot';
		const existingCommentId = parseUniqueAikidoID(comment.body)

		if (!isBot || existingCommentId === undefined) continue;

		let matchedFinding = undefined
		for (const finding of findings) {
			const findingId = parseUniqueAikidoID(finding.body)

			if (findingId != existingCommentId) continue;

			matchedFinding = finding
		}

		if (typeof matchedFinding === 'undefined') {
			await octokit.rest.pulls.deleteReviewComment({
				...context.repo,
				pull_number: pullRequestNumber,
				comment_id: comment.id
			});
		}
	}

	// Add new review comments
	for (const finding of findings) {
		const findingId = parseUniqueAikidoID(finding.body)

		if (findingId === undefined) continue;

		let existingFinding = undefined
		for (const comment of reviewComments) {
			const isBot = comment.user?.type === 'Bot';
			const existingCommentId = parseUniqueAikidoID(comment.body)

			if (!isBot || existingCommentId === undefined || findingId != existingCommentId) continue;

			existingFinding = comment
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
