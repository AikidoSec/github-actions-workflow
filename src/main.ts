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
		const fromSeverity: string = core.getInput('minimum-severity');
		const failOnTimeout: string = core.getInput('fail-on-timeout');
		const failOnDependencyScan: string = core.getInput('fail-on-dependency-scan');
		const failOnSastScan: string = core.getInput('fail-on-sast-scan');
		const failOnSecretsScan: string = core.getInput('fail-on-secrets-scan');

		if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(fromSeverity.toUpperCase())) {
			core.setOutput('output', STATUS_FAILED);
			core.info(`Invalid property value for minimum-severity. Allowed values are: LOW, MEDIUM, HIGH, CRITICAL`);
			return;
		}

		const startScanPayload = {
			repository_id: github.context.payload.repository?.node_id,
			start_commit_id: github.context.payload?.pull_request?.base?.sha || github.context.payload?.before,
			end_commit_id: github.context.payload?.pull_request?.head?.sha || github.context.payload?.after,
			author:
				github.context.payload?.pull_request?.user?.login ||
				github.context.payload?.head_commit?.author?.username,
			ref: github.context.payload?.pull_request?.head?.ref || github.context.payload?.ref,
			pull_request_metadata: {
				title: github.context.payload?.pull_request?.title,
				url: github.context.payload?.pull_request?.html_url,
			},
			is_pull_request: github.context.eventName === 'pull_request',
			workflow_version: '1.0.4',
			// user config
			fail_on_dependency_scan: failOnDependencyScan,
			fail_on_sast_scan: failOnSastScan,
			fail_on_secrets_scan: failOnSecretsScan,
			from_severity: fromSeverity,
		};

		const scanId = await startScan(secretKey, startScanPayload);

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

			const {
				new_critical_issues_found = 0,
				issue_links = [],
				new_dependency_issues_found = 0,
				new_secrets_issues_found = 0,
				new_sast_issues_found = 0,
			} = result;

			if (new_critical_issues_found > 0) {
				for (const linkToIssue of issue_links) {
					core.error(`New critical issue detected. Check it out at: ${linkToIssue}`);
				}

				throw new Error(`dependency scan completed: found ${new_critical_issues_found} new critical issues`);
			}

			if (new_dependency_issues_found > 0) {
				throw new Error(`${new_dependency_issues_found} new dependency issue(s) detected.`);
			}
			if (new_secrets_issues_found > 0) {
				throw new Error(`${new_secrets_issues_found} new secret(s) detected.`);
			}
			if (new_sast_issues_found > 0) {
				throw new Error(`${new_sast_issues_found} new SAST issue(s) detected.`);
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
