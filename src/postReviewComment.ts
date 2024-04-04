import * as core from '@actions/core';
import * as github from '@actions/github';

type TFinding = { commit_id: string, path: string, line: number, body: string }

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

	for (const finding of findings) {
		let existingFinding = undefined
		for (const comment of reviewComments) {
			const isBot = comment.user?.type === 'Bot';
			const isAikidoScannerBot = comment.body?.toLowerCase().includes('https://app.aikido.dev/featurebranch/scan/');

			if (!isBot || !isAikidoScannerBot || comment.commit_id != finding.commit_id, comment.path != finding.path || comment.line != finding.line || comment.body != finding.body) continue;

			existingFinding = comment
		}

		if (typeof existingFinding === 'undefined') {
			await octokit.rest.pulls.createReviewComment({
				...context.repo,
				pull_number: pullRequestNumber,
				...finding,
			});
		}
	}
};
