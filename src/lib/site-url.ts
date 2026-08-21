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

/**
 * Public origin for a request handled behind a reverse proxy. `request.url`
 * is the upstream address there (e.g. https://localhost:3000), so redirects
 * built from it would send users to localhost. Prefer the proxy's forwarded
 * host, then the configured site origin, then the request itself.
 */
export function getRequestOrigin(request: {
	headers: { get(name: string): string | null };
	nextUrl: { origin: string };
}) {
	const forwardedHost = request.headers
		.get("x-forwarded-host")
		?.split(",")[0]
		?.trim();
	if (forwardedHost) {
		const proto =
			request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
			"https";
		const origin = normalizeSiteOrigin(`${proto}://${forwardedHost}`);
		if (origin) return origin;
	}
	return getConfiguredSiteOrigin() ?? request.nextUrl.origin;
}
