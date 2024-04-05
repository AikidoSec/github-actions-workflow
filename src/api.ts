import * as httpClient from '@actions/http-client';
import { TypedResponse } from '@actions/http-client/lib/interfaces';

const AIKIDO_API_URL = 'https://app.aikido.dev';

type StartScanResponse = { scan_id: number };

export type GetScanStatusResponse =
	| {
			new_sast_issues_found?: number;
			new_iac_issues_found?: number;
			new_dependency_issues_found?: number;
			all_scans_completed: true;
			new_issues_found?: number;
			issue_links?: string[];
			diff_url?: string;
			gate_passed?: boolean;
			outcome?: {
				human_readable_message: string;
			};
	  }
	| {
			all_scans_completed: false;
	  };

export type GetScanFindingsResponse =
		{
			group_id: number,
			start_commit_id?: string,
			end_commit_id: string,
			introduced_sast_issues: [
				{
					author?: string,
					start_column?: number,
					end_column?: number,
					start_line: number,
					end_line: number,
					snippet_hash: string,
					title: string,
					description: string,
					remediation: string,
					file: string
				}
			]
		}

export const startScan = async (secret: string, payload: Object): Promise<number> => {
	const requestClient = new httpClient.HttpClient('ci-github-actions');

	const url = `${AIKIDO_API_URL}/api/integrations/continuous_integration/scan/repository`;

	let response: TypedResponse<StartScanResponse> | undefined;
	try {
		response = await requestClient.postJson<StartScanResponse>(url, payload, { 'X-AIK-API-SECRET': secret });
	} catch (error) {
		if (error instanceof httpClient.HttpClientError && error.statusCode === 401) {
			throw new Error(
				`Start scan failed. The provided api key is most likely no longer valid and has been rotated or revoked. Visit https://app.aikido.dev/settings/integrations/continuous-integration to generate a new key.`
			);
		}

		if (error instanceof httpClient.HttpClientError && (error.statusCode >= 400 || error.statusCode <= 499)) {
			throw new Error(`start scan failed: ${error.message}`);
		}

		throw new Error(`start scan failed: an unexpected error occurred whilst starting the scan`);
	}

	if (response === undefined) throw new Error(`start scan failed: did not get a response`);

	if (response.statusCode !== 200) {
		throw new Error(`start scan failed: unable to start scan: ${JSON.stringify(response.result ?? {})}`);
	}

	if (response.result?.scan_id) return response.result.scan_id;

	throw new Error(`start scan failed: no scan_id received in the response: ${response.result}`);
};

export const getScanStatus = (secret: string, scanId: number): (() => Promise<GetScanStatusResponse>) => {
	const requestClient = new httpClient.HttpClient('ci-github-actions');

	return async (): Promise<GetScanStatusResponse> => {
		const url = new URL(`${AIKIDO_API_URL}/api/integrations/continuous_integration/scan/repository`);
		url.searchParams.set('scan_id', scanId.toString());

		const response = await requestClient.getJson<GetScanStatusResponse>(url.toString(), {
			'X-AIK-API-SECRET': secret,
		});

		if (response.statusCode !== 200 || !response.result) {
			throw new Error(
				`check if scan is complete failed: did not receive a good result: ${JSON.stringify(
					response.result ?? {}
				)}`
			);
		}

		return response.result;
	};
};

export const getScanFindings = async (secret: string, scanId: number): Promise<GetScanFindingsResponse> => {
	const requestClient = new httpClient.HttpClient('ci-github-actions');

	const url = new URL(`${AIKIDO_API_URL}/api/integrations/continuous_integration/scan/${scanId}/introducedSastIssues`);

	const response = await requestClient.getJson<GetScanFindingsResponse>(url.toString(), {
		'X-AIK-API-SECRET': secret,
	});

	if (response.statusCode !== 200 || !response.result) {
		throw new Error(
			`fetch findings failed: did not receive a good result: ${JSON.stringify(
				response.result ?? {}
			)}`
		);
	}

	return response.result;
};
