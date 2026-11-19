import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { NextRequest, NextResponse } from "next/server";
import { SCOPE_OPTIONS, SORT_OPTIONS } from "./constants/items";
import configJSON from "./constants/config.json";
import { PUBLIC_READ_CACHE_CONTROL } from "./lib/http-cache";
import meilisearch from "./lib/meilisearch";
import { getConfiguredSiteOrigin } from "./lib/site-url";
import { normalizePathname } from "./lib/path";
import {
	AI_RATE_LIMIT_COOKIE_NAME,
	AI_RATE_LIMIT_COOKIE_PATH,
	AI_RATE_LIMIT_COOKIE_MAX_AGE_SECONDS,
	AIRateLimitUnavailableError,
	aiRateLimitHeaders,
	consumeAIRateLimit,
	resolveAIRateLimitClientIdentity,
	translationRateLimitPolicy,
} from "./lib/ai/rate-limit";

function withAIRateLimitClientCookie(
	response: NextResponse,
	request: NextRequest,
	identity: ReturnType<typeof resolveAIRateLimitClientIdentity>,
) {
	if (!identity.shouldSetCookie) return response;

	response.cookies.set({
		name: AI_RATE_LIMIT_COOKIE_NAME,
		value: identity.clientId,
		httpOnly: true,
		sameSite: "strict",
		secure: request.nextUrl.protocol === "https:",
		path: AI_RATE_LIMIT_COOKIE_PATH,
		maxAge: AI_RATE_LIMIT_COOKIE_MAX_AGE_SECONDS,
	});
	return response;
}

function handleLegacyScope(
	request: NextRequest,
	scope: string,
	variables: Record<string, any>
) {
	variables.scopes = variables.scopes || [];
	variables.scopes.push(scope);

	if (variables.scopes.length > 1) {
		request.nextUrl.searchParams.set("scope", SCOPE_OPTIONS[0].key);
	} else {
		const newScopeValue = Object.values(SCOPE_OPTIONS).find(
			(option) => option.legacyKey === scope
		)?.key;
		if (newScopeValue) {
			request.nextUrl.searchParams.set("scope", newScopeValue);
		}
	}
}

type KeyMap = {
	key: string;
	mapper: (
		value: string,
		request: NextRequest,
		variables: Record<string, any>
	) => any;
};

type ConfigCollection = {
	title: string;
	enabled: boolean;
	legacyKey?: string;
};

const scopeMaps: Record<string, KeyMap> = Object.values(SCOPE_OPTIONS).reduce(
	(acc: Record<string, KeyMap>, option) => {
		acc[option.legacyKey] = {
			key: "search",
			mapper: (
				value: string,
				request: NextRequest,
				variables: Record<string, any>
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
	{} as Record<string, KeyMap>
);

const collections =
	configJSON.collections[
		(process.env.MEILI_INDEX ||
			configJSON.index) as keyof typeof configJSON.collections
	] || {};

const collectionsMaps: Record<string, KeyMap> = Object.values(
	collections as Record<string, ConfigCollection>
)
	.filter((option) => option.enabled && option.legacyKey)
	.reduce((acc: Record<string, KeyMap>, option) => {
		acc[option.legacyKey as keyof typeof acc] = {
			key: "collections",
			mapper: (
				value: string,
				request: NextRequest,
				variables: Record<string, any>
			) => {
				const allCollections = (
					request.nextUrl.searchParams.get("collections") || ""
				)
					.split(",")
					.filter(Boolean);
				const collectionsToAppend = value.split(".").filter(Boolean);
				const newCollections = Array.from(
					new Set([...allCollections, ...collectionsToAppend])
				);
				const finalCollections = newCollections.join(",");
				request.nextUrl.searchParams.set(
					"collections",
					finalCollections
				);
			},
		};
		return acc;
	}, {} as Record<string, KeyMap>);

const keyMaps: Record<string, KeyMap> = Object.assign(
	{
		sort: {
			key: "sort",
			mapper: (value: string, request: NextRequest) => {
				const newValue = Object.values(SORT_OPTIONS).find(
					(option) => option.legacyKey === value
				)?.key;
				if (newValue) {
					request.nextUrl.searchParams.set("sort", newValue);
				}
			},
		},
	},
	scopeMaps,
	collectionsMaps
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

function mapLegacySearchParams(request: NextRequest) {
	const originalSearchParams = new URLSearchParams(
		request.nextUrl.searchParams
	);
	const variables: Record<string, any> = {};
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
	const pathSegments = routing.locales.includes(firstSegment as any)
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
		getConfiguredSiteOrigin() ?? request.nextUrl.origin
	);

	try {
		const response = await Promise.race([
			fetch(apiUrl, {
				headers: {
					"x-redirect-lookup": "1",
				},
			}),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("timeout")), 350)
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

function getPathLocale(pathname: string) {
	const firstSegment = pathname.split("/").filter(Boolean)[0];
	return routing.locales.includes(firstSegment as any) ? firstSegment : null;
}

function redirectUnknownPathToNotFoundPage(request: NextRequest) {
	if (!getRedirectLookupPath(request.nextUrl.pathname)) return null;

	const url = request.nextUrl.clone();
	const locale = getPathLocale(request.nextUrl.pathname);
	url.pathname = locale ? `/${locale}/404` : "/404";
	url.search = "";

	return NextResponse.redirect(url, 307);
}

export default async function proxy(request: NextRequest) {
	if (request.nextUrl.pathname === "/") {
		const url = request.nextUrl.clone();
		url.pathname = "/lib";
		return NextResponse.redirect(url);
	}

	const newRequest = mapLegacySearchParams(request);

	if (newRequest) {
		return newRequest;
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
			try {
				const compositeKey =
					(process.env.MEILI_INDEX || configJSON.index) + "|" + resolvedKey;
				const encoding = encodeKey(compositeKey);

				const redirects = (await Promise.race([
					meilisearch.index("redirects").getDocument(encoding),
					new Promise((_, reject) =>
						setTimeout(
							() => reject(new Error("timeout")),
							350
						)
					),
				])) as Record<string, unknown>;

				const finalKey = redirects?.value && redirects.value !== resolvedKey
					? String(redirects.value)
					: resolvedKey;

				if (finalKey !== key) {
					const url = request.nextUrl.clone();
					url.pathname = `/lib/${finalKey}${rest}`;
					return NextResponse.redirect(url, 301);
				}
			} catch {
				// Timeout or not found - still redirect broken keys to cleaned version
				if (resolvedKey !== key) {
					const url = request.nextUrl.clone();
					url.pathname = `/lib/${resolvedKey}${rest}`;
					return NextResponse.redirect(url, 301);
				}
			}
		}
	}

	const supportedFormats = ["ris", "bibtex"];

	const exportMatch = request.nextUrl.pathname.match(
		/\/lib\/(.+?)\/export\/(ris|bibtex)$/
	);
	if (exportMatch) {
		if (!supportedFormats.includes(exportMatch[2])) {
			return NextResponse.json(
				{
					error: `Unsupported export format. Supported formats are: ${supportedFormats.join(
						", "
					)}`,
				},
				{ status: 400 }
			);
		}
		const key = exportMatch[1];
		const format = exportMatch[2];
		const url = request.nextUrl.clone();
		url.pathname = `/api/item/${key}/export/${format}`;
		return NextResponse.rewrite(url);
	}

	const downloadMatch = request.nextUrl.pathname.match(
		/\/lib\/(.+?)\/download\/?(?:([^\/]+)(.*))?$/
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
	} else if (
		request.nextUrl.pathname === "/lib/atom.xml" ||
		(request.nextUrl.pathname.startsWith("/profile/") &&
			request.nextUrl.pathname.endsWith("/atom.xml"))
	) {
		const id = request.nextUrl.pathname.startsWith("/profile/")
			? request.nextUrl.pathname.split("/")[2]
			: "main";
		const url = request.nextUrl.clone();
		url.pathname = `/api/feed/${id}`;
		return NextResponse.rewrite(url);
	} else if (request.nextUrl.pathname.startsWith("/api/")) {
		if (
			request.method === "POST" &&
			(request.nextUrl.pathname === "/api/ai" ||
				request.nextUrl.pathname.startsWith("/api/ai/"))
		) {
			const clientIp =
				request.headers.get("x-real-ip")?.trim() || "unknown";
			const clientIdentity = resolveAIRateLimitClientIdentity(
				request.cookies.get(AI_RATE_LIMIT_COOKIE_NAME)?.value,
			);
			let rateLimit;
			try {
				rateLimit = await consumeAIRateLimit(
					{ clientId: clientIdentity.clientId, clientIp },
					request.nextUrl.pathname === "/api/ai/translate"
						? translationRateLimitPolicy()
						: undefined,
				);
			} catch (error) {
				if (!(error instanceof AIRateLimitUnavailableError))
					throw error;
				return withAIRateLimitClientCookie(
					NextResponse.json(
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
								"Cache-Control": "no-store",
								"Retry-After": "5",
							},
						},
					),
					request,
					clientIdentity,
				);
			}
			const headers = aiRateLimitHeaders(rateLimit);

			if (!rateLimit.allowed) {
				const response = NextResponse.json(
					{
						error: {
							code: "RATE_LIMITED",
							message: "Rate limit exceeded.",
						},
					},
					{ status: 429, headers },
				);
				return withAIRateLimitClientCookie(
					response,
					request,
					clientIdentity,
				);
			}

			const response = NextResponse.next();
			for (const [name, value] of Object.entries(headers)) {
				response.headers.set(name, value);
			}
			return withAIRateLimitClientCookie(
				response,
				request,
				clientIdentity,
			);
		}

		return NextResponse.next();
	}

	const noteRedirectDestination = await getNoteRedirectDestination(request);
	if (noteRedirectDestination) {
		return NextResponse.redirect(noteRedirectDestination, 307);
	}

	const notFoundPageRedirect = redirectUnknownPathToNotFoundPage(request);
	if (notFoundPageRedirect) {
		return notFoundPageRedirect;
	}

	const response = createMiddleware(routing)(request);

	if (isPublicLibraryPage(request.nextUrl.pathname)) {
		response.headers.set("Cache-Control", PUBLIC_READ_CACHE_CONTROL);
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
		"/([\\w-]+)?/profile/:id/atom.xml",
		// Add specific matcher for DOI URLs - using Next.js path matching syntax
		"/lib/:doi/:rest*",
	],
};
