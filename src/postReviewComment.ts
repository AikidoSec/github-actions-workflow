import * as core from '@actions/core';
import * as github from '@actions/github';
import * as crypto from 'crypto';

type TFinding = { commit_id: string, path: string, line: number, start_line: number, body: string }

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

	// Add review comments
	for (const finding of findings) {
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
};
