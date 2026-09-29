/** Maps values with at most `limit` calls running at once, keeping their order. */
export async function mapWithConcurrency<T, R>(
	values: readonly T[],
	limit: number,
	run: (value: T) => Promise<R>,
) {
	const results: R[] = new Array(values.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, values.length) }, async () => {
			while (next < values.length) {
				const index = next++;
				results[index] = await run(values[index]!);
			}
		}),
	);
	return results;
}
