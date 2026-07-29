export function chunkValues<T>(values: T[], size: number) {
	const output: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		output.push(values.slice(index, index + size));
	}
	return output;
}
