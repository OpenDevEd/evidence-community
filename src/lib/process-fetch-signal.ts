export function installProcessFetchAbortSignal(signal: AbortSignal) {
	const originalFetch = globalThis.fetch;
	const abortableFetch: typeof globalThis.fetch = (input, init = {}) => {
		const signals = [signal, init.signal].filter(
			(candidate): candidate is AbortSignal => candidate != null,
		);
		return originalFetch(input, {
			...init,
			signal: AbortSignal.any(signals),
		});
	};
	globalThis.fetch = abortableFetch;

	return () => {
		if (globalThis.fetch === abortableFetch) {
			globalThis.fetch = originalFetch;
		}
	};
}
