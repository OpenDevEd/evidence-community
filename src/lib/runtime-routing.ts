import { getPlatformPathLocale } from "@/i18n/runtime";

function firstForwardedValue(value: string | null) {
	return value?.split(",")[0]?.trim() || null;
}

export function getExternalRequestOrigin(
	requestUrl: URL,
	headers: Pick<Headers, "get">,
) {
	const host =
		firstForwardedValue(headers.get("x-forwarded-host")) ??
		firstForwardedValue(headers.get("host")) ??
		requestUrl.host;
	const protocol =
		firstForwardedValue(headers.get("x-forwarded-proto")) ??
		requestUrl.protocol.replace(/:$/u, "");
	if (protocol !== "http" && protocol !== "https") return null;

	try {
		return new URL(`${protocol}://${host}`).origin;
	} catch {
		return null;
	}
}

export function hasMatchingRequestOrigin(
	requestUrl: URL,
	headers: Pick<Headers, "get">,
) {
	const origin = headers.get("origin");
	return !origin || origin === getExternalRequestOrigin(requestUrl, headers);
}

function isLoopbackHost(host: string) {
	try {
		const hostname = new URL(`http://${host}`).hostname
			.replace(/^\[|\]$/g, "")
			.toLowerCase();
		return (
			hostname === "localhost" ||
			hostname === "127.0.0.1" ||
			hostname === "::1"
		);
	} catch {
		return false;
	}
}

export function getUnlocalizedPathname(pathname: string) {
	const locale = getPlatformPathLocale(pathname);
	if (!locale) return pathname;

	const unlocalizedPathname = pathname.slice(locale.length + 1);
	return unlocalizedPathname || "/";
}

/**
 * Every path segment the library serves itself. A request that starts with
 * one of these is a real page, so it must never be treated as an unknown
 * address that needs a redirect or the "page not found" screen.
 */
const RESERVED_ROUTE_SEGMENTS = new Set([
	"404",
	"about",
	"admin",
	"api",
	"citation",
	"contact",
	"cookie-policy",
	"gapmaps",
	"lib",
	"map",
	"newlib",
	"privacy",
	"profile",
	"statistics",
	"takedown",
	"terms",
]);

/**
 * The address to look up in the owner's redirect list, or `null` when the
 * request already points at a page the library serves.
 */
export function getRedirectLookupPath(pathname: string) {
	const segments = pathname.split("/").filter(Boolean);
	if (segments.length === 0) return null;

	const pathSegments = getPlatformPathLocale(pathname)
		? segments.slice(1)
		: segments;

	if (pathSegments.length === 0) return null;
	if (RESERVED_ROUTE_SEGMENTS.has(pathSegments[0])) return null;

	return pathSegments.join("/");
}

export function isLoginProfilePath(pathname: string) {
	return /^\/profile(?:\/|$)/u.test(getUnlocalizedPathname(pathname));
}

export function getCanonicalLibraryRedirect(
	requestUrl: URL,
	headers: Headers,
	baseUrl: string,
) {
	const forwardedHost = firstForwardedValue(headers.get("x-forwarded-host"));
	const requestHost =
		forwardedHost ??
		firstForwardedValue(headers.get("host")) ??
		requestUrl.host;
	const requestProtocol = forwardedHost
		? null
		: requestUrl.protocol.replace(/:$/u, "");
	const canonicalUrl = new URL(baseUrl);
	const hasCanonicalHost =
		requestHost.toLowerCase() === canonicalUrl.host.toLowerCase();
	const hasCanonicalProtocol =
		requestProtocol === null ||
		requestProtocol.toLowerCase() ===
			canonicalUrl.protocol.replace(/:$/u, "").toLowerCase();

	if (
		isLoopbackHost(requestHost) ||
		(hasCanonicalHost && hasCanonicalProtocol)
	) {
		return null;
	}

	return new URL(requestUrl.pathname + requestUrl.search, canonicalUrl);
}
