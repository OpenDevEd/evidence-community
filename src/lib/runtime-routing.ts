import { getPlatformPathLocale } from "@/i18n/runtime";
import { normalizePathname } from "@/lib/path";

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
 * Pages whose first section runs to the top of the window: the map and the
 * home page hero. The header floats over them at its smaller size and the page
 * drops its top padding. While the home page is off `/` is never rendered, so
 * it needs no check here.
 */
export function pageRunsUnderHeader(pathname: string): boolean {
	const path = getUnlocalizedPathname(normalizePathname(pathname));
	return path === "/" || path.includes("/map");
}

/**
 * Every path segment the library serves itself, together with everything
 * below it. A request that starts with one of these is a real page, so it
 * must never be treated as an unknown address that needs a redirect or the
 * "page not found" screen.
 */
const RESERVED_ROUTE_SEGMENTS = new Set([
	"digests",
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
]);

/**
 * The address to look up in the owner's redirect list, or `null` when the
 * request already points at a page the library serves.
 *
 * The terms route serves configured text or a policy destination, only at exactly
 * `/terms`. Reserving the whole `/terms` branch would silently switch off the
 * owner's own redirects for addresses such as `/terms/archive`.
 */
export function getRedirectLookupPath(
	pathname: string,
	hasConfiguredTerms: boolean,
) {
	const segments = pathname.split("/").filter(Boolean);
	if (segments.length === 0) return null;

	const pathSegments = getPlatformPathLocale(pathname)
		? segments.slice(1)
		: segments;

	if (pathSegments.length === 0) return null;
	if (RESERVED_ROUTE_SEGMENTS.has(pathSegments[0])) return null;
	if (
		hasConfiguredTerms &&
		pathSegments.length === 1 &&
		pathSegments[0] === "terms"
	) {
		return null;
	}

	return pathSegments.join("/");
}

export function isLoginProfilePath(pathname: string) {
	return /^\/profile(?:\/|$)/u.test(getUnlocalizedPathname(pathname));
}

export const ADMIN_HOME_PATH = "/admin";

const adminPageMethods = ["GET", "HEAD"] as const;

export const ADMIN_PAGE_METHODS = adminPageMethods.join(", ");

export function isAdminPageMethod(method: string) {
	return adminPageMethods.some((pageMethod) => pageMethod === method);
}

export function isAdminPagePath(pathname: string) {
	const unlocalizedPathname = getUnlocalizedPathname(pathname);
	return (
		unlocalizedPathname === ADMIN_HOME_PATH ||
		unlocalizedPathname.startsWith("/admin/")
	);
}

const adminReturnBaseOrigin = "https://return.invalid";

/**
 * Only a path inside this library's admin may be used as a return target.
 * Anything else, including a full URL or a protocol-relative address, falls
 * back to the admin home page.
 */
export function getValidatedAdminReturnPath(value: string | null | undefined) {
	if (!value || !value.startsWith("/")) return ADMIN_HOME_PATH;

	let returnUrl: URL;
	try {
		returnUrl = new URL(value, adminReturnBaseOrigin);
	} catch {
		return ADMIN_HOME_PATH;
	}
	if (returnUrl.origin !== adminReturnBaseOrigin) return ADMIN_HOME_PATH;

	const pathname = getUnlocalizedPathname(returnUrl.pathname);
	if (pathname !== ADMIN_HOME_PATH && !pathname.startsWith("/admin/")) {
		return ADMIN_HOME_PATH;
	}

	return `${returnUrl.pathname}${returnUrl.search}`;
}

const ADMIN_SIGN_IN_PATH = "/api/admin/sign-in";

/** The library's own route that starts OpenScholar sign-in and returns to an admin page. */
export function buildAdminSignInPath(returnPath: string | null | undefined) {
	return `${ADMIN_SIGN_IN_PATH}?${new URLSearchParams({ return: getValidatedAdminReturnPath(returnPath) })}`;
}

export const LIBRARY_CONFIG_HEALTH_PATH = "/api/library-config/health";

export function getLibraryConfigProbeHeaders(platformOrigin: string) {
	return {
		"X-Forwarded-Host": new URL(platformOrigin).host,
		"X-Forwarded-Proto": "https",
	} as const;
}

export function getCanonicalLibraryRedirect(
	requestUrl: URL,
	headers: Headers,
	baseUrl: string,
) {
	// OpenScholar probes this route through a newly attached host before that
	// host can become canonical. The route must answer with the live revision.
	if (requestUrl.pathname === LIBRARY_CONFIG_HEALTH_PATH) return null;

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
