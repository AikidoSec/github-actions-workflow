import * as core from '@actions/core';
import * as github from '@actions/github';

import { getScanStatus, startScan } from './api';
import { getCurrentUnixTime, sleep } from './time';

const STATUS_FAILED = 'FAILED';
const STATUS_SUCCEEDED = 'SUCCEEDED';
const STATUS_TIMED_OUT = 'TIMED_OUT';

async function run(): Promise<void> {
	try {
		const secretKey: string = core.getInput('secret-key');
		const failOnTimeout: string = core.getInput('fail-on-timeout');

		const startScanPayload = {
			repository_id: github.context.payload.repository?.node_id,
			start_commit_id: github.context.payload?.before,
			end_commit_id: github.context.payload?.after,
			author:
				github.context.payload?.pull_request?.user?.login ||
				github.context.payload?.head_commit?.author?.username,
			ref: github.context.payload?.pull_request?.head?.ref || github.context.payload?.ref,
			pull_request_metadata: {
				pull_request_url: github.context.payload?.pull_request?.html_url,
				start_commit_id: github.context.payload?.pull_request?.base?.sha,
				end_commit_id: github.context.payload?.pull_request?.head?.sha,
			},
		};

		const scanId = await startScan(secretKey, startScanPayload);

		core.info(`DEBUG: ${JSON.stringify(github)}`);

		core.info(`successfully started a scan with id: "${scanId}"`);

		const getScanCompletionStatus = getScanStatus(secretKey, scanId);

		const expirationTimestamp = getCurrentUnixTime() + 120 * 1000; // 2 minutes from now

		let scanIsCompleted = false;

		core.info('==== check if scan is completed ====');

		do {
			const result = await getScanCompletionStatus();

			if (!result.scan_completed) {
				core.info('==== scan is not yet completed, wait a few seconds ====');
				await sleep(5000);

				const dependencyScanTimeoutReached = getCurrentUnixTime() > expirationTimestamp;
				if (dependencyScanTimeoutReached) {
					if (failOnTimeout === 'true') {
						core.setOutput('output', STATUS_FAILED);
						core.setFailed(
							`dependency scan reached time out: the scan did not complete within the set timeout`
						);
						return;
					}

					core.setOutput('output', STATUS_TIMED_OUT);
					core.info(`dependency scan reached time out: the scan did not complete within the set timeout.`);
					return;
				}

				continue;
			}

			scanIsCompleted = true;

			if (result.new_critical_issues_found > 0) {
				for (const linkToIssue of result.issue_links) {
					core.error(`New critical issue detected. Check it out at: ${linkToIssue}`);
				}

				throw new Error(
					`dependency scan completed: found ${result.new_critical_issues_found} new critical issues`
				);
			}

			core.info('==== scan is completed, no new critical issues found ====');
		} while (!scanIsCompleted);

		core.setOutput('outcome', STATUS_SUCCEEDED);
	} catch (error) {
		core.setOutput('outcome', STATUS_FAILED);
		if (error instanceof Error) core.setFailed(error.message);
	}
}

void run();
