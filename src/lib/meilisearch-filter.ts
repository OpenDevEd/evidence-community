const FILTER_FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_.]*$/u;

export function meilisearchString(value: string) {
	return JSON.stringify(value);
}

export function meilisearchEquals(field: string, value: string) {
	if (!FILTER_FIELD_PATTERN.test(field)) {
		throw new Error(`Invalid Meilisearch filter field: ${field}`);
	}
	return `${field} = ${meilisearchString(value)}`;
}

export function meilisearchIn(field: string, values: readonly string[]) {
	if (!FILTER_FIELD_PATTERN.test(field)) {
		throw new Error(`Invalid Meilisearch filter field: ${field}`);
	}
	return `${field} IN [${values.map(meilisearchString).join(",")}]`;
}
