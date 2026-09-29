/**
 * Maps values with at most `limit` calls running at once, keeping their order.
 * After a failure no new call starts, and it rejects once every running call
 * has finished, so nothing keeps running behind the caller's back.
 */
export async function mapWithConcurrency<T, R>(
	values: readonly T[],
	limit: number,
	run: (value: T) => Promise<R>,
) {
	const results: R[] = new Array(values.length);
	let next = 0;
	let failure: { error: unknown } | null = null;
	await Promise.all(
		Array.from({ length: Math.min(limit, values.length) }, async () => {
			while (!failure && next < values.length) {
				const index = next++;
				try {
					results[index] = await run(values[index]!);
				} catch (error) {
					failure ??= { error };
				}
			}
		}),
	);
	if (failure) throw (failure as { error: unknown }).error;
	return results;
}
