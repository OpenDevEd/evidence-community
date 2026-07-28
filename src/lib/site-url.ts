export function normalizeSiteOrigin(rawValue: string | undefined) {
	if (!rawValue) return null;

	const trimmedValue = rawValue.trim();
	if (!trimmedValue) return null;

	try {
		const candidate = trimmedValue.includes("://")
			? trimmedValue
			: `https://${trimmedValue}`;

		return new URL("/", candidate).origin;
	} catch {
		return null;
	}
}

export function buildSiteUrl(pathname: string, baseUrl: string) {
	return new URL(pathname, `${baseUrl}/`).toString();
}
