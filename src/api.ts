import * as httpClient from '@actions/http-client';

const AIKIDO_API_URL = 'https://app.test.aikido.dev';

type GetScanStatusResponse = {
	scan_completed: boolean;
	new_critical_issues_found: number;
	issues: string;
};

export const startScan = async (secret: string, payload: Object): Promise<number> => {
	const requestClient = new httpClient.HttpClient('ci-github-actions');

	const url = `${AIKIDO_API_URL}/api/integrations/continuous_integration/scan/repository`;
	const response = await requestClient.postJson<{ scan_id: number }>(url, payload, { 'X-AIK-API-SECRET': secret });

	if (response.statusCode !== 200) {
		throw new Error(`start scan failed: unable to start scan: ${JSON.stringify(response.result ?? {})}`);
	}

	if (response.result?.scan_id) return response.result.scan_id;

	throw new Error(`start scan failed: no scan_id received in the response: ${response.result}`);
};

export const checkIfScanIsCompleted = (secret: string, scanId: number): (() => Promise<GetScanStatusResponse>) => {
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
