export function chunkValues<T>(values: readonly T[], size: number) {
	if (!Number.isSafeInteger(size) || size < 1) {
		throw new Error("Chunk size must be a positive integer");
	}
	const output: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		output.push(values.slice(index, index + size));
	}
	return output;
}
