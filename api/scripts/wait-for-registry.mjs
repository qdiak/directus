/* eslint-env es2021 */
/** Waits for the release registry contract within a fixed deadline; lookup errors fail immediately. */
export async function waitForRegistry(read, isReady, { timeoutMs, intervalMs = 1000, errorMessage }) {
	const deadline = Date.now() + timeoutMs;

	for (;;) {
		const value = await read();
		if (isReady(value)) return value;
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw new Error(errorMessage);
		await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
	}
}
