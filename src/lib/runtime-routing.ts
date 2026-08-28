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

export function isLoginProfilePath(pathname: string) {
	return /^\/profile(?:\/|$)/u.test(getUnlocalizedPathname(pathname));
}

export const ADMIN_HOME_PATH = "/admin";

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

export function buildAdminLoginPageUrl(
	loginPageUrl: string,
	returnPath: string | null | undefined,
	error?: "invalid_code",
) {
	const url = new URL(loginPageUrl);
	if (error) url.searchParams.set("error", error);
	url.searchParams.set("return", getValidatedAdminReturnPath(returnPath));
	return url.toString();
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
