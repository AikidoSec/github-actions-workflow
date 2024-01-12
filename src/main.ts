import * as core from '@actions/core';
import * as github from '@actions/github';

import { getScanStatus, startScan } from './api';
import { getCurrentUnixTime, sleep } from './time';
import { postScanStatusMessage } from './postMessage';

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
		const failOnIacScan: string = core.getInput('fail-on-iac-scan');
		const timeoutInSeconds = parseTimeoutDuration(core.getInput('timeout-seconds'));
		const postScanStatusAsComment = core.getInput('post-scan-status-comment');

		if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(fromSeverity.toUpperCase())) {
			core.setOutput('output', STATUS_FAILED);
			core.info(`Invalid property value for minimum-severity. Allowed values are: LOW, MEDIUM, HIGH, CRITICAL`);
			return;
		}

		const startScanPayload = {
			version: '1.0.5',
			branch_name: github.context.payload?.pull_request?.head?.ref || github.context.payload?.ref,
			repository_id: github.context.payload.repository?.node_id,
			base_commit_id: github.context.payload?.pull_request?.base?.sha || github.context.payload?.before,
			head_commit_id: github.context.payload?.pull_request?.head?.sha || github.context.payload?.after,
			author:
				github.context.payload?.pull_request?.user?.login ||
				github.context.payload?.head_commit?.author?.username,
			pull_request_metadata: {
				title: github.context.payload?.pull_request?.title,
				url: github.context.payload?.pull_request?.html_url,
			},

			// user config
			fail_on_dependency_scan: failOnDependencyScan,
			fail_on_sast_scan: failOnSastScan,
			fail_on_iac_scan: failOnIacScan,
			minimum_severity: fromSeverity,
		};

		const scanId = await startScan(secretKey, startScanPayload);

		core.info(`successfully started a scan with id: "${scanId}"`);

		const getScanCompletionStatus = getScanStatus(secretKey, scanId);

		const expirationTimestamp = getCurrentUnixTime() + timeoutInSeconds * 1000;

		let scanIsCompleted = false;

		core.info('==== check if scan is completed ====');

		do {
			const result = await getScanCompletionStatus();

			if (!result.all_scans_completed) {
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

			let moreDetailsText = '';
			if (result.diff_url) {
				moreDetailsText = ` More details at ${result.diff_url}`;
			}

			if (postScanStatusAsComment === 'true' && !!result.outcome?.human_readable_message) {
				await postScanStatusMessage(result.outcome?.human_readable_message);
			}

			core.setOutput('scanResultUrl', result.diff_url);

			const {
				gate_passed = false,
				new_issues_found = 0,
				issue_links = [],
				new_dependency_issues_found = 0,
				new_iac_issues_found = 0,
				new_sast_issues_found = 0,
			} = result;

			if (!gate_passed) {
				for (const linkToIssue of issue_links) {
					core.error(`New issue detected with severity >=${fromSeverity}. Check it out at: ${linkToIssue}`);
				}

				throw new Error(
					`dependency scan completed: found ${new_issues_found} new issues with severity >=${fromSeverity}.${moreDetailsText}`
				);
			}

			if (new_dependency_issues_found > 0) {
				throw new Error(`${new_dependency_issues_found} new dependency issue(s) detected.${moreDetailsText}`);
			}
			if (new_iac_issues_found > 0) {
				throw new Error(`${new_iac_issues_found} new IaC issue(s) detected.${moreDetailsText}`);
			}
			if (new_sast_issues_found > 0) {
				throw new Error(`${new_sast_issues_found} new SAST issue(s) detected.${moreDetailsText}`);
			}

			core.info(
				`==== scan is completed, no new issues with severity >=${fromSeverity} found.${moreDetailsText} ====`
			);
		} while (!scanIsCompleted);

		core.setOutput('outcome', STATUS_SUCCEEDED);
	} catch (error) {
		core.setOutput('outcome', STATUS_FAILED);
		if (error instanceof Error) core.setFailed(error.message);
	}
}

function parseTimeoutDuration(rawTimeoutInSeconds: string): number {
	if (rawTimeoutInSeconds === '') return 120;

	try {
		return parseInt(rawTimeoutInSeconds, 10);
	} catch (error) {
		throw new Error(
			`Invalid timeout provided. The provided timeout should be a valid number, but got: "${rawTimeoutInSeconds}"`
		);
	}
}

void run();
