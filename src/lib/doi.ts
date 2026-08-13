const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/iu;

export function normalizeDoi(value: string | null | undefined) {
	if (!value) return null;
	const trimmed = value
		.trim()
		.replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "")
		.replace(/^doi:\s*/iu, "")
		.replace(/^<(.+)>$/u, "$1");
	return DOI_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}
