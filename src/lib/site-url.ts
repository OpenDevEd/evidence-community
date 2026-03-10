const SITE_URL_ENV_KEYS = [
	"BASE_URL",
	"VERCEL_PROJECT_PRODUCTION_URL",
	"VERCEL_URL",
] as const;

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

export function getConfiguredSiteOrigin() {
	for (const envKey of SITE_URL_ENV_KEYS) {
		const siteOrigin = normalizeSiteOrigin(process.env[envKey]);
		if (siteOrigin) return siteOrigin;
	}

	return null;
}

export function getSiteOrigin() {
	const siteOrigin = getConfiguredSiteOrigin();

	if (!siteOrigin) {
		throw new Error(
			"BASE_URL or a Vercel site URL environment variable must be configured."
		);
	}

	return siteOrigin;
}

export function buildSiteUrl(pathname: string, baseUrl = getSiteOrigin()) {
	return new URL(pathname, `${baseUrl}/`).toString();
}

export function getSiteHost() {
	const siteOrigin = getConfiguredSiteOrigin();

	if (!siteOrigin) return null;

	return new URL(siteOrigin).host;
}
