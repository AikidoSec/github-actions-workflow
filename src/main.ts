import * as core from '@actions/core';
import * as github from '@actions/github';

import { getScanStatus, startScan, getScanFindings } from './api';
import { getCurrentUnixTime, sleep } from './time';
import { postScanStatusMessage } from './postMessage';
import { postFindingsAsReviewComments } from './postReviewComment';
import { transformPostScanStatusAsComment } from './transformers/transformPostScanStatusAsComment';
import { transformPostFindingsAsReviewComment } from './transformers/transformPostFindingsAsReviewComment';

const STATUS_FAILED = 'FAILED';
const STATUS_SUCCEEDED = 'SUCCEEDED';
const STATUS_TIMED_OUT = 'TIMED_OUT';

const ALLOWED_POST_SCAN_STATUS_OPTIONS = ['on', 'off', 'only_if_new_findings'];
const ALLOWED_POST_REVIEW_COMMENTS_OPTIONS = ['on', 'off'];

async function run(): Promise<void> {
	try {
		const secretKey: string = core.getInput('secret-key');
		const fromSeverity: string = core.getInput('minimum-severity');
		const failOnTimeout: string = core.getInput('fail-on-timeout');
		const failOnDependencyScan: string = core.getInput('fail-on-dependency-scan');
		const failOnSastScan: string = core.getInput('fail-on-sast-scan');
		const failOnIacScan: string = core.getInput('fail-on-iac-scan');
		const timeoutInSeconds = parseTimeoutDuration(core.getInput('timeout-seconds'));
		let postScanStatusAsComment = core.getInput('post-scan-status-comment');
		let postReviewComments = core.getInput('post-sast-review-comments');

		if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(fromSeverity.toUpperCase())) {
			core.setOutput('output', STATUS_FAILED);
			core.setFailed(`Invalid property value for minimum-severity. Allowed values are: LOW, MEDIUM, HIGH, CRITICAL`);
			return;
		}

		postScanStatusAsComment = transformPostScanStatusAsComment(postScanStatusAsComment);
		if (!ALLOWED_POST_SCAN_STATUS_OPTIONS.includes(postScanStatusAsComment)) {
			core.setOutput('ouput', STATUS_FAILED);
			core.setFailed(`Invalid property value for post-scan-status-comment. Allowed values are: ${ALLOWED_POST_SCAN_STATUS_OPTIONS.join(', ')}`);
			return;
		}

		postReviewComments = transformPostFindingsAsReviewComment(postReviewComments);
		if (!ALLOWED_POST_REVIEW_COMMENTS_OPTIONS.includes(postReviewComments)) {
			core.info(`I shouldn't be here`)
			core.setOutput('ouput', STATUS_FAILED);
			core.setFailed(`Invalid property value for post-sast-review-comments. Allowed values are: ${ALLOWED_POST_SCAN_STATUS_OPTIONS.join(', ')}`);
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

		if (secretKey) {
			const redactedToken = '********************' + secretKey.slice(-4);
			core.info(`starting a scan with secret key: "${redactedToken}"`);
		} else {
			const isLikelyDependabotPr = (startScanPayload.branch_name ?? '').starts_with('dependabot/')
			if (isLikelyDependabotPr) {
				core.info(`it looks like the action is running on a dependabot PR, this means that secret variables are not available in this context and thus we can not start a scan. Please see: https://github.blog/changelog/2021-02-19-github-actions-workflows-triggered-by-dependabot-prs-will-run-with-read-only-permissions/`);
				core.setOutput('outcome', STATUS_SUCCEEDED);
				return;
			}

			core.info(`secret key not set.`);
		}

		if (failOnDependencyScan === 'false' && failOnIacScan === 'false' && failOnSastScan === 'false') {
			core.setOutput('output', STATUS_FAILED);
			core.setFailed(`You must enable at least one of the scans.`);
			return;
		}

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

			const shouldPostComment = (postScanStatusAsComment === 'on' || postScanStatusAsComment === 'only_if_new_findings');
			if (shouldPostComment && !!result.outcome?.human_readable_message) {
				try {
					const options = { onlyIfNewFindings: postScanStatusAsComment === 'only_if_new_findings', hasNewFindings: !!result.gate_passed };
					await postScanStatusMessage(result.outcome?.human_readable_message, options);
				} catch (error) {
					if (error instanceof Error) {
						core.info(`unable to post scan status comment due to error: ${error.message}`);
					} else {
						core.info(`unable to post scan status comment due to unknown error`);
					}
				}
			}

			const shouldPostReviewComments = (postReviewComments === 'on');
			if (shouldPostReviewComments) {
				await createReviewComments(secretKey, scanId)
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

async function createReviewComments(secretKey: string, scanId: number): Promise<void> {
	try {
		const findingResponse = await getScanFindings(secretKey, scanId)

		const findings = findingResponse.introduced_sast_issues.map(finding => (
			{
				commit_id: findingResponse.end_commit_id,
				path: finding.file,
				line: finding.end_line,
				start_line: finding.start_line,
				body: `${finding.title}\n${finding.description}\n**Remediation:** ${finding.remediation}\n**Details**: [View details](https://app.aikido.dev/featurebranch/scan/${scanId})`
			}
		))
		
		if (findings.length > 0) {
			await postFindingsAsReviewComments(findings);
		}
	} catch (error) {
		if (error instanceof Error) {
			core.info(`unable to post review comments due to error: ${error.message}`);
		} else {
			core.info(`unable to post review comments due to unknown error`);
		}
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
