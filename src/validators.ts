export const parseTimeout = (timeout: string): number => {
	const parsedTimeout = parseInt(timeout);
	if (isNaN(parsedTimeout))
		throw new Error(
			`parseTimeout failed: the provided timeout: "${timeout}" could not be parsed to a valid number`
		);

	return parsedTimeout;
};
