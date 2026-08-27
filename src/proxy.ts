import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { SCOPE_OPTIONS, SORT_OPTIONS } from "./constants/items";
import { loadLibraryConfig } from "./config/library-config/source";
import {
	getDisabledLocaleRedirectPathname,
	getOrderedRuntimeLocales,
	getPlatformPathLocale,
	RUNTIME_LOCALE_COOKIE,
} from "./i18n/runtime";
import {
	PRIVATE_NO_STORE_CACHE_CONTROL,
	PUBLIC_READ_CACHE_CONTROL,
} from "./lib/http-cache";
import { getMeilisearchForConfig } from "./lib/meilisearch";
import { normalizePathname } from "./lib/path";
import {
	getCanonicalLibraryRedirect,
	getUnlocalizedPathname,
	isLoginProfilePath,
} from "./lib/runtime-routing";
import {
	resolveRuntimeSearchScope,
	type RuntimeSearch,
} from "./config/library-config/search";
import {
	consumeAIRateLimit,
	type AIRateLimitStatus,
} from "./lib/ai-rate-limit";

function isRateLimitedAIRequest(request: NextRequest) {
	return (
		request.method === "POST" &&
		(request.nextUrl.pathname === "/api/ai" ||
			request.nextUrl.pathname.startsWith("/api/ai/"))
	);
}

function setAIRateLimitHeaders(
	response: NextResponse,
	status: AIRateLimitStatus,
) {
	response.headers.set("X-RateLimit-Limit", String(status.limit));
	response.headers.set("X-RateLimit-Remaining", String(status.remaining));
	response.headers.set("X-RateLimit-Reset", String(status.resetAt));
	if (!status.allowed) {
		response.headers.set("Retry-After", String(status.retryAfter));
	}
	return response;
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

function encodeKey(key: string): string {
	return key
		.split("")
		.map((char) => char.charCodeAt(0).toString(36))
		.join("n");
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
]);

function getRedirectLookupPath(pathname: string) {
	const segments = pathname.split("/").filter(Boolean);
	if (segments.length === 0) return null;

	const firstSegment = segments[0];
	const pathSegments = getPlatformPathLocale(pathname)
		? segments.slice(1)
		: segments;

	if (pathSegments.length === 0) return null;
	if (RESERVED_ROUTE_SEGMENTS.has(pathSegments[0])) return null;

	return pathSegments.join("/");
}

async function getNoteRedirectDestination(request: NextRequest) {
	const lookupPath = getRedirectLookupPath(request.nextUrl.pathname);
	if (!lookupPath) return null;

	const apiUrl = new URL(
		`/api/redirects/${lookupPath.split("/").map(encodeURIComponent).join("/")}`,
		request.nextUrl.origin,
	);

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

function redirectUnknownPathToNotFoundPage(request: NextRequest) {
	if (!getRedirectLookupPath(request.nextUrl.pathname)) return null;

	const url = request.nextUrl.clone();
	const locale = getPlatformPathLocale(request.nextUrl.pathname);
	url.pathname = locale ? `/${locale}/404` : "/404";
	url.search = "";

	return NextResponse.redirect(url, 307);
}

export default async function proxy(request: NextRequest) {
	const libraryConfig = await loadLibraryConfig();
	const canonicalRedirect = getCanonicalLibraryRedirect(
		request.nextUrl,
		request.headers,
		libraryConfig.identity.baseUrl,
	);
	if (canonicalRedirect) {
		return NextResponse.redirect(canonicalRedirect, 308);
	}

	if (request.nextUrl.pathname === "/") {
		const url = request.nextUrl.clone();
		url.pathname = "/lib";
		return NextResponse.redirect(url);
	}

	const newRequest = mapLegacySearchParams(request, libraryConfig.search);

	if (newRequest) {
		return newRequest;
	}

	const unlocalizedPathname = getUnlocalizedPathname(
		request.nextUrl.pathname,
	);
	if (
		!libraryConfig.features.login &&
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
					const { indexName, redirectsIndex } =
						await getMeilisearchForConfig(libraryConfig);
					const compositeKey = indexName + "|" + resolvedKey;
					const encoding = encodeKey(compositeKey);

					const redirects = (await Promise.race([
						redirectsIndex.getDocument(encoding),
						new Promise((_, reject) =>
							setTimeout(() => reject(new Error("timeout")), 350),
						),
					])) as Record<string, unknown>;

					if (redirects?.value && redirects.value !== resolvedKey) {
						finalKey = String(redirects.value);
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
			const rateLimit = consumeAIRateLimit(request.headers);
			if (!rateLimit.allowed) {
				return setAIRateLimitHeaders(
					NextResponse.json(
						{ error: "Rate limit exceeded" },
						{ status: 429 },
					),
					rateLimit,
				);
			}
			return setAIRateLimitHeaders(NextResponse.next(), rateLimit);
		}
		return NextResponse.next();
	}

	const disabledLocaleRedirectPathname = getDisabledLocaleRedirectPathname(
		request.nextUrl.pathname,
		libraryConfig.localization,
	);
	if (disabledLocaleRedirectPathname) {
		const url = request.nextUrl.clone();
		url.pathname = disabledLocaleRedirectPathname;
		return NextResponse.redirect(url, 307);
	}

	if (libraryConfig.generation.redirects) {
		const noteRedirectDestination =
			await getNoteRedirectDestination(request);
		if (noteRedirectDestination) {
			return NextResponse.redirect(noteRedirectDestination, 307);
		}
	}

	const notFoundPageRedirect = redirectUnknownPathToNotFoundPage(request);
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
		const isRedirect = response.status >= 300 && response.status < 400;
		const setsLocaleCookie = response.headers.has("set-cookie");
		const variesByLocaleDetection =
			libraryConfig.localization.detectLocale &&
			(!getPlatformPathLocale(request.nextUrl.pathname) ||
				isInternalLocaleRewrite);
		response.headers.set(
			"Cache-Control",
			isRedirect ||
				setsLocaleCookie ||
				hasLocaleRewriteHeader ||
				variesByLocaleDetection
				? PRIVATE_NO_STORE_CACHE_CONTROL
				: PUBLIC_READ_CACHE_CONTROL,
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
