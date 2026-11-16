import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { SCOPE_OPTIONS, SORT_OPTIONS } from "./constants/items";
import { loadLibraryConfig } from "./config/library-config/source";
import { isLibraryFeatureEnabled } from "./config/library-config/features";
import { getRuntimePageAvailability } from "./config/library-config/pages";
import type { LibraryServerConfig } from "./config/library-config/schema";
import {
	getDisabledLocaleRedirectPathname,
	getOrderedRuntimeLocales,
	getPlatformPathLocale,
	RUNTIME_LOCALE_COOKIE,
} from "./i18n/runtime";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "./lib/http-cache";
import { readItemRedirect } from "./lib/item-redirects";
import { normalizePathname } from "./lib/path";
import { getSessionCookie } from "better-auth/cookies";
import {
	ADMIN_PAGE_METHODS,
	buildAdminSignInPath,
	getCanonicalLibraryRedirect,
	getExternalRequestOrigin,
	getRedirectLookupPath,
	getUnlocalizedPathname,
	isAdminPageMethod,
	isAdminPagePath,
	isLoginProfilePath,
} from "./lib/runtime-routing";
import {
	resolveRuntimeSearchScope,
	type RuntimeSearch,
} from "./config/library-config/search";
import {
	AI_RATE_LIMIT_COOKIE_MAX_AGE_SECONDS,
	AI_RATE_LIMIT_COOKIE_NAME,
	AI_RATE_LIMIT_COOKIE_PATH,
	aiRateLimitHeaders,
	consumeAIRateLimit,
	resolveAIRateLimitClientIdentity,
} from "./lib/ai/rate-limit";

function isRateLimitedAIRequest(request: NextRequest) {
	return (
		request.method === "POST" &&
		(request.nextUrl.pathname === "/api/ai" ||
			request.nextUrl.pathname.startsWith("/api/ai/"))
	);
}

function trustedClientIp(request: NextRequest) {
	const address = request.headers.get("x-real-ip")?.trim();
	return address && address.length <= 128 ? address : "unresolved-client";
}

function setAIRateLimitCookie(
	request: NextRequest,
	response: NextResponse,
	clientId: string,
	shouldSetCookie: boolean,
) {
	if (!shouldSetCookie) return response;

	response.cookies.set({
		name: AI_RATE_LIMIT_COOKIE_NAME,
		value: clientId,
		httpOnly: true,
		sameSite: "strict",
		secure:
			getExternalRequestOrigin(request.nextUrl, request.headers)?.startsWith(
				"https://",
			) ?? false,
		path: AI_RATE_LIMIT_COOKIE_PATH,
		maxAge: AI_RATE_LIMIT_COOKIE_MAX_AGE_SECONDS,
	});
	return response;
}

async function getAIRateLimitResponse(
	request: NextRequest,
	libraryConfig: LibraryServerConfig,
) {
	const clientIp = trustedClientIp(request);
	const identity = resolveAIRateLimitClientIdentity(
		request.cookies.get(AI_RATE_LIMIT_COOKIE_NAME)?.value,
	);

	try {
		const result = await consumeAIRateLimit(
			{
				clientId: identity.clientId,
				clientIp,
				persistentClient: !identity.shouldSetCookie,
			},
			libraryConfig,
		);
		const response = result.allowed
			? NextResponse.next()
			: NextResponse.json(
					{
						error: {
							code: "RATE_LIMITED",
							message: `You have reached the AI request limit. Try again in ${result.retryAfter} seconds.`,
						},
					},
					{ status: 429 },
				);

		for (const [name, value] of Object.entries(
			aiRateLimitHeaders(result),
		)) {
			response.headers.set(name, value);
		}
		response.headers.set("Cache-Control", PRIVATE_NO_STORE_CACHE_CONTROL);
		return setAIRateLimitCookie(
			request,
			response,
			identity.clientId,
			identity.shouldSetCookie,
		);
	} catch (error) {
		console.error("[AI rate limit unavailable]", error);
		const response = NextResponse.json(
			{
				error: {
					code: "RATE_LIMIT_UNAVAILABLE",
					message:
						"AI access is temporarily unavailable. Try again shortly.",
				},
			},
			{
				status: 503,
				headers: {
					"Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL,
					"Retry-After": "5",
				},
			},
		);
		return setAIRateLimitCookie(
			request,
			response,
			identity.clientId,
			identity.shouldSetCookie,
		);
	}
}

function handleLegacyScope(
	request: NextRequest,
	scope: string,
	variables: Record<string, any>,
) {
	variables.scopes = variables.scopes || [];
	variables.scopes.push(scope);

	if (variables.scopes.length > 1) {
		request.nextUrl.searchParams.set(
			"scope",
			variables.runtimeSearch.defaultScope,
		);
	} else {
		const newScopeValue = Object.values(SCOPE_OPTIONS).find(
			(option) => option.legacyKey === scope,
		)?.key;
		if (newScopeValue) {
			request.nextUrl.searchParams.set(
				"scope",
				resolveRuntimeSearchScope(
					newScopeValue,
					variables.runtimeSearch,
				),
			);
		}
	}
}

type KeyMap = {
	key: string;
	mapper: (
		value: string,
		request: NextRequest,
		variables: Record<string, any>,
	) => any;
};

const scopeMaps: Record<string, KeyMap> = Object.values(SCOPE_OPTIONS).reduce(
	(acc: Record<string, KeyMap>, option) => {
		acc[option.legacyKey] = {
			key: "search",
			mapper: (
				value: string,
				request: NextRequest,
				variables: Record<string, any>,
			) => {
				handleLegacyScope(request, option.legacyKey, variables);
				const oldSearch =
					request.nextUrl.searchParams.get("search") || "";
				const newSearch = oldSearch
					? `${oldSearch} "${value}"`
					: `"${value}"`;
				request.nextUrl.searchParams.set("search", newSearch);
			},
		};
		return acc;
	},
	{} as Record<string, KeyMap>,
);

const keyMaps: Record<string, KeyMap> = Object.assign(
	{
		sort: {
			key: "sort",
			mapper: (value: string, request: NextRequest) => {
				const newValue = Object.values(SORT_OPTIONS).find(
					(option) => option.legacyKey === value,
				)?.key;
				if (newValue) {
					request.nextUrl.searchParams.set("sort", newValue);
				}
			},
		},
	},
	scopeMaps,
);

function isPublicLibraryPage(pathname: string) {
	return /(?:^|\/)lib(?:\/[^/]+)?$/.test(normalizePathname(pathname));
}

function mapLegacySearchParams(
	request: NextRequest,
	runtimeSearch: RuntimeSearch,
) {
	const originalSearchParams = new URLSearchParams(
		request.nextUrl.searchParams,
	);
	const variables: Record<string, any> = { runtimeSearch };
	const entries = Array.from(request.nextUrl.searchParams.entries());

	for (const [key, value] of entries) {
		const mapped = keyMaps[key as keyof typeof keyMaps];
		if (mapped) {
			const newKey = mapped.key;
			mapped.mapper(value, request, variables);
			if (key !== newKey) {
				request.nextUrl.searchParams.delete(key);
			}
		}
	}

	const finalSearchParams = new URLSearchParams(request.nextUrl.searchParams);

	if (originalSearchParams.toString() !== finalSearchParams.toString()) {
		return NextResponse.redirect(request.nextUrl);
	}

	return null;
}

function isLikelyZoteroKey(key: string) {
	return /^[A-Z0-9]{8}$/.test(key);
}

function isLikelyBrokenKey(key: string) {
	return /^\d+:[A-Z0-9]{8}$/.test(key);
}

async function getNoteRedirectDestination(
	request: NextRequest,
	hasConfiguredTerms: boolean,
) {
	const lookupPath = getRedirectLookupPath(
		request.nextUrl.pathname,
		hasConfiguredTerms,
	);
	if (!lookupPath) return null;

	const apiUrl = new URL(
		`/api/redirects/${lookupPath.split("/").map(encodeURIComponent).join("/")}`,
		request.nextUrl.origin,
	);
	// The lookup goes to this server, which answers plain HTTP. Behind the community's proxy the request reads as
	// https://localhost:3000, and a TLS request to it fails, which sent every configured redirect to the 404 page.
	apiUrl.protocol = "http:";

	try {
		const response = await Promise.race([
			fetch(apiUrl, {
				cache: "no-store",
				headers: {
					"x-redirect-lookup": "1",
				},
			}),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("timeout")), 350),
			),
		]);

		if (!response.ok) return null;

		const data = (await response.json()) as {
			destination?: unknown;
		};
		if (typeof data.destination !== "string" || !data.destination) {
			return null;
		}

		const destination = new URL(data.destination, request.url);
		if (!["http:", "https:"].includes(destination.protocol)) return null;

		return destination;
	} catch {
		return null;
	}
}

function redirectUnknownPathToNotFoundPage(
	request: NextRequest,
	hasConfiguredTerms: boolean,
) {
	if (
		!getRedirectLookupPath(request.nextUrl.pathname, hasConfiguredTerms)
	) {
		return null;
	}

	const url = request.nextUrl.clone();
	const locale = getPlatformPathLocale(request.nextUrl.pathname);
	url.pathname = locale ? `/${locale}/404` : "/404";
	url.search = "";

	return NextResponse.redirect(url, 307);
}

function adminMethodNotAllowedResponse() {
	return new NextResponse("Method Not Allowed", {
		headers: {
			Allow: ADMIN_PAGE_METHODS,
			"Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL,
			"Content-Type": "text/plain; charset=utf-8",
		},
		status: 405,
	});
}

/** Only whether a session cookie is there: the admin page checks the session and the role itself. */
function hasSessionCookie(request: NextRequest) {
	return Boolean(getSessionCookie(request, { cookiePrefix: "evidence-library" }));
}

function getDisabledLocaleRedirect(
	request: NextRequest,
	localization: LibraryServerConfig["localization"],
) {
	const pathname = getDisabledLocaleRedirectPathname(
		request.nextUrl.pathname,
		localization,
	);
	if (!pathname) return null;

	const url = request.nextUrl.clone();
	url.pathname = pathname;
	return NextResponse.redirect(url, 307);
}

function getAdminPageResponse(request: NextRequest) {
	if (!isAdminPagePath(request.nextUrl.pathname)) return null;
	// An admin page only ever answers a page request. Sending anything else
	// into sign-in would repeat the method and the body on another site.
	if (!isAdminPageMethod(request.method)) {
		return adminMethodNotAllowedResponse();
	}
	if (hasSessionCookie(request)) return null;

	const origin = getExternalRequestOrigin(request.nextUrl, request.headers) ?? request.nextUrl.origin;
	return NextResponse.redirect(
		new URL(buildAdminSignInPath(`${request.nextUrl.pathname}${request.nextUrl.search}`), origin),
		307,
	);
}

// The admin page must answer with a real redirect. Rendering it and calling
// redirect() there streams a 200 first, so the browser would see the
// card-free page instead of the sign-in redirect. Nothing else may answer
// first: a switched-off locale is dropped here, and the legacy query rules
// never turn a refused method into a redirect.
function getAdminRequestResponse(
	request: NextRequest,
	libraryConfig: LibraryServerConfig,
) {
	if (!isAdminPagePath(request.nextUrl.pathname)) return null;

	return (
		getDisabledLocaleRedirect(request, libraryConfig.localization) ??
		getAdminPageResponse(request)
	);
}

export default async function proxy(request: NextRequest) {
	const libraryConfig = await loadLibraryConfig();
	const canonicalRedirect = getCanonicalLibraryRedirect(
		request.nextUrl,
		request.headers,
		libraryConfig.identity.baseUrl,
	);
	if (canonicalRedirect) {
		return NextResponse.redirect(canonicalRedirect, 307);
	}

	// Without a home page of its own the library opens on the listing.
	if (
		request.nextUrl.pathname === "/" &&
		!isLibraryFeatureEnabled(libraryConfig.features, "homePage")
	) {
		const url = request.nextUrl.clone();
		url.pathname = "/lib";
		return NextResponse.redirect(url);
	}

	const adminRequestResponse = getAdminRequestResponse(
		request,
		libraryConfig,
	);
	if (adminRequestResponse) return adminRequestResponse;

	const newRequest = mapLegacySearchParams(request, libraryConfig.search);

	if (newRequest) {
		return newRequest;
	}

	const unlocalizedPathname = getUnlocalizedPathname(
		request.nextUrl.pathname,
	);
	if (
		!libraryConfig.features.readerAccounts &&
		isLoginProfilePath(request.nextUrl.pathname)
	) {
		return new NextResponse("Not Found", {
			status: 404,
			headers: {
				"Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL,
				"Content-Type": "text/plain; charset=utf-8",
			},
		});
	}

	const configuredExportMatch = unlocalizedPathname.match(
		/^\/lib\/export\/(ris|bibtex)$/u,
	);
	if (configuredExportMatch) {
		const url = request.nextUrl.clone();
		url.pathname = `/api/exports/${configuredExportMatch[1]}`;
		return NextResponse.rewrite(url);
	}

	if (unlocalizedPathname === "/lib/atom.xml") {
		const url = request.nextUrl.clone();
		url.pathname = "/api/exports/atom";
		return NextResponse.rewrite(url);
	}

	const configuredGapMapMatch = unlocalizedPathname.match(
		/^\/gapmaps\/([a-z0-9][a-z0-9-]*)\.html$/u,
	);
	if (configuredGapMapMatch) {
		const url = request.nextUrl.clone();
		url.pathname = `/api/gapmaps/${configuredGapMapMatch[1]}`;
		return NextResponse.rewrite(url);
	}

	// Check for redirections for item keys in URLs like /lib/{key}
	const libItemMatch = request.nextUrl.pathname.match(/\/lib\/([^\/]+)(.*)/);
	if (libItemMatch) {
		const key = libItemMatch[1];
		const rest = libItemMatch[2] || "";

		const resolvedKey = isLikelyBrokenKey(String(key))
			? String(key).split(":")[1]
			: String(key);

		if (isLikelyZoteroKey(resolvedKey)) {
			let finalKey = resolvedKey;

			if (libraryConfig.generation.redirects) {
				try {
					const redirect = await readItemRedirect(libraryConfig, resolvedKey);
					if (redirect && redirect !== resolvedKey) {
						finalKey = redirect;
					}
				} catch {
					// A redirect lookup failure still allows structural
					// normalization of legacy prefixed keys below.
				}
			}

			if (finalKey !== key) {
				const url = request.nextUrl.clone();
				url.pathname = `/lib/${finalKey}${rest}`;
				return NextResponse.redirect(url, 301);
			}
		}
	}

	const supportedFormats = ["ris", "bibtex"];

	const exportMatch = request.nextUrl.pathname.match(
		/\/lib\/(.+?)\/export\/(ris|bibtex)$/,
	);
	if (exportMatch) {
		if (!supportedFormats.includes(exportMatch[2])) {
			return NextResponse.json(
				{
					error: `Unsupported export format. Supported formats are: ${supportedFormats.join(
						", ",
					)}`,
				},
				{ status: 400 },
			);
		}
		const key = exportMatch[1];
		const format = exportMatch[2];
		const url = request.nextUrl.clone();
		url.pathname = `/api/item/${key}/export/${format}`;
		return NextResponse.rewrite(url);
	}

	const downloadMatch = request.nextUrl.pathname.match(
		/\/lib\/(.+?)\/download\/?(?:([^\/]+)(.*))?$/,
	);
	if (downloadMatch) {
		const itemKey = downloadMatch[1];
		const attachmentKey = downloadMatch[2];

		if (!attachmentKey) {
			const url = request.nextUrl.clone();
			url.pathname = `/lib/${itemKey}`;
			url.searchParams.set("message", "selectPDF");
			return NextResponse.redirect(url);
		}

		const url = request.nextUrl.clone();
		url.pathname = `/api/item/${itemKey}/download/${attachmentKey}`;
		return NextResponse.rewrite(url);
	} else if (request.nextUrl.pathname.startsWith("/api/")) {
		if (libraryConfig.features.ai && isRateLimitedAIRequest(request)) {
			return getAIRateLimitResponse(request, libraryConfig);
		}
		// Anyone may hand records to OpenScholar, which keeps each hand-off a week under this library's credential:
		// a visitor's hand-offs take from the same windows as their AI requests, where the library keeps them.
		if (request.method === "POST" && request.nextUrl.pathname === "/api/handoff" && libraryConfig.services.redis) {
			return getAIRateLimitResponse(request, libraryConfig);
		}
		return NextResponse.next();
	}

	const disabledLocaleRedirect = getDisabledLocaleRedirect(
		request,
		libraryConfig.localization,
	);
	if (disabledLocaleRedirect) return disabledLocaleRedirect;

	const hasConfiguredTerms = getRuntimePageAvailability(libraryConfig)["/terms"];
	if (libraryConfig.generation.redirects) {
		const noteRedirectDestination = await getNoteRedirectDestination(
			request,
			hasConfiguredTerms,
		);
		if (noteRedirectDestination) {
			return NextResponse.redirect(noteRedirectDestination, 307);
		}
	}

	const notFoundPageRedirect = redirectUnknownPathToNotFoundPage(
		request,
		hasConfiguredTerms,
	);
	if (notFoundPageRedirect) {
		return notFoundPageRedirect;
	}

	const hasLocaleRewriteHeader = request.headers.has("x-next-intl-locale");
	const isInternalLocaleRewrite =
		hasLocaleRewriteHeader &&
		getPlatformPathLocale(request.nextUrl.pathname) !== null;
	const response = createMiddleware({
		locales: getOrderedRuntimeLocales(libraryConfig.localization),
		defaultLocale: libraryConfig.localization.defaultLocale,
		localeDetection: libraryConfig.localization.detectLocale,
		// Next.js can pass an internal next-intl rewrite through the proxy a
		// second time. Preserve the already-resolved locale on that internal
		// request instead of canonicalizing it back to the public unprefixed
		// URL and creating a redirect loop.
		localePrefix: isInternalLocaleRewrite ? "always" : "as-needed",
		localeCookie: RUNTIME_LOCALE_COOKIE,
		alternateLinks: false,
	})(request);

	if (isPublicLibraryPage(request.nextUrl.pathname)) {
		// Next normalizes page and RSC requests before the proxy, then can add
		// redirects afterward. Neither can safely inherit public cache headers.
		// The public data APIs own their cache policy separately.
		response.headers.set(
			"Cache-Control",
			PRIVATE_NO_STORE_CACHE_CONTROL,
		);
	}

	return response;
}

export const config = {
	// Matcher entries are linked with a logical "or", therefore
	// if one of them matches, the proxy will be invoked.
	matcher: [
		// Match all pathnames except for specific prefixes and file extensions
		"/((?!_next|_vercel|backend|.*\\..*).*)",
		// Updated matchers for new export URL format
		"/([\\w-]+)?/lib/:path*/export/ris",
		"/([\\w-]+)?/lib/:path*/export/bibtex",
		"/([\\w-]+)?/lib/:path*/download/:path*",
		"/([\\w-]+)?/lib/atom.xml",
		"/gapmaps/:slug.html",
		// Add specific matcher for DOI URLs - using Next.js path matching syntax
		"/lib/:doi/:rest*",
	],
};
