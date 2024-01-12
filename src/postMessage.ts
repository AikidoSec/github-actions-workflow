import * as core from '@actions/core';
import * as github from '@actions/github';

export const postScanStatusMessage = async (messageBody: string): Promise<void> => {
	const githubToken = core.getInput('github-token');
	if (!githubToken || githubToken === '') {
		core.error('unable to post scan status: missing github-token input parameter');
		return;
	}

	const context = github.context;
	if (context.payload.pull_request == null) {
		core.error('unable to post scan status: action is not run in a pull request context');
		return;
	}

	const pullRequestNumber = context.payload.pull_request.number;

	const octokit = github.getOctokit(githubToken);

	const { data: comments } = await octokit.rest.issues.listComments({
		owner: context.repo.owner,
		repo: context.repo.repo,
		issue_number: pullRequestNumber,
	});

	let intialBotComment = undefined;
	for (const comment of comments) {
		const isBot = comment.user?.type === 'Bot';
		const isAikidoScannerBot = comment.body?.toLowerCase().includes('https://app.aikido.dev/featurebranch/scan/');

		if (!isBot || !isAikidoScannerBot) continue; // not our bot, keep looking

		// we found our initial comment
		intialBotComment = comment;
		break;
	}

	// no initial comment, let's create one!
	if (typeof intialBotComment === 'undefined') {
		await octokit.rest.issues.createComment({
			...context.repo,
			issue_number: pullRequestNumber,
			body: messageBody,
		});
		return;
	}

	await octokit.rest.issues.updateComment({
		owner: context.repo.owner,
		repo: context.repo.repo,
		comment_id: intialBotComment.id,
		body: messageBody,
	});
};
