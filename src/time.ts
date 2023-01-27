export const sleep = async (ms: number): Promise<void> => {
	return new Promise((resolve) => setTimeout(resolve, ms));
};

export const getCurrentUnixTime = (): number => {
	const now = new Date();
	return now.getTime();
};
