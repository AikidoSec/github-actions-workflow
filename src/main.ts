import * as core from '@actions/core';
import * as github from '@actions/github';

import { checkIfScanIsCompleted, startScan } from './api';
import { getCurrentUnixTime, sleep } from './time';
import { parseTimeout } from './validators';

const STATUS_FAILED = 'failed';
const STATUS_SUCCEEDED = 'SUCCEEDED';
const STATUS_TIMED_OUT = 'TIMED_OUT';

async function run(): Promise<void> {
	try {
		const secretKey: string = core.getInput('secret-key');
		const rawMaxTimeout: string = core.getInput('max-timeout');

		const maxTimeout = parseTimeout(rawMaxTimeout);

		const startScanPayload = {
			repository_id: github.context.payload.repository?.node_id,
			start_commit_id: github.context.payload?.before,
			end_commit_id: github.context.payload?.after,
			author: github.context.payload?.head_commit?.author?.username,
			ref: github.context.payload?.ref,
		};

		const scanId = await startScan(secretKey, startScanPayload);

		core.info(`successfully started a scan with id: "${scanId}"`);

		const isScanCompleted = checkIfScanIsCompleted(secretKey, scanId);

		const expirationTimestamp = getCurrentUnixTime() + maxTimeout * 1000;

		let scanIsCompleted = false;

		core.info('==== check if scan is completed ====');

		do {
			const result = await isScanCompleted();

			if (!result.scan_completed) {
				core.info('==== scan is not yet completed, wait a few seconds ====');
				await sleep(10000);

				if (getCurrentUnixTime() > expirationTimestamp) {
					core.info(
						`dependency scan reached time out: the scan did not complete within the requested timeout.`
					);
					core.setOutput('output', STATUS_TIMED_OUT);
					return;
				}

				continue;
			}

			scanIsCompleted = true;

			if (result.new_critical_issues_found > 0) {
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
