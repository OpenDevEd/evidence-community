import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { NextRequest, NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { ItemGetResponse } from "./app/api/item/types";
import redirections from "./constants/redirections.json";
import { SCOPE_OPTIONS, SORT_OPTIONS } from "./constants/items";
import configJSON from "./constants/config.json";
import { ConsoleLogWriter } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";

export type RateLimit = {
	count: number;
	firstRequest: number;
};

export const rateLimits = new Map<string, RateLimit>();

const AMOUNT_OF_REQUESTS = 10;
const RESET_TIME = 60000;

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

function generateRateLimitObject(
	request: NextRequest,
	userId?: string | null
) {
	const ip =
		request.headers.get("x-forwarded-for") ||
		request.headers.get("x-real-ip") ||
		request.headers.get("cf-connecting-ip") ||
		request.headers.get("x-envoy-external-address");
	const userRateLimitKey = userId ? `user:${userId}` : null;
	const userRateLimit = userRateLimitKey
		? rateLimits.get(userRateLimitKey) || { count: 0, firstRequest: 0 }
		: null;
	const ipRateLimit = ip
		? rateLimits.get(ip) || { count: 0, firstRequest: 0 }
		: null;

	let rateLimit = null;
	if (userRateLimit && ipRateLimit) {
		rateLimit =
			ipRateLimit.count > userRateLimit.count
				? ipRateLimit
				: userRateLimit;
	} else {
		rateLimit = userRateLimit || ipRateLimit || {
			count: 0,
			firstRequest: 0,
		};
	}

	if (userRateLimitKey) {
		rateLimits.set(userRateLimitKey, rateLimit);
	}

	if (ip) {
		rateLimits.set(ip, rateLimit);
	}

	return rateLimit;
}

function setRateLimitHeaders(
	response: NextResponse,
	rateLimit: RateLimit | null
) {
	if (rateLimit) {
		response.headers.set(
			"X-RateLimit-Limit",
			AMOUNT_OF_REQUESTS.toString()
		);
		response.headers.set(
			"X-RateLimit-Remaining",
			(AMOUNT_OF_REQUESTS - rateLimit.count).toString()
		);
		response.headers.set(
			"X-RateLimit-Reset",
			(rateLimit.firstRequest + RESET_TIME).toString()
		);

		if (rateLimit.count >= AMOUNT_OF_REQUESTS) {
			const retryAfter = Math.ceil(
				(rateLimit.firstRequest + RESET_TIME - Date.now()) / 1000
			);
			response.headers.set("Retry-After", retryAfter.toString());
		}
	}

	return response;
}

function fixRequestUrl(request: NextRequest) {
	const url = request.url.toString();
	return process.env.REPLACE_HTTPS === "true"
		? url.replace("https://", "http://")
		: url;
}

function getInternalRequestUrl(request: NextRequest, pathname: string) {
	// Preserve the incoming scheme for same-origin self-fetches.
	return new URL(pathname, request.nextUrl.origin);
}

async function modifyPDFMetadata(
	pdfUrl: string,
	title: string | null
): Promise<Uint8Array | null> {
	try {
		// Fetch the PDF from the URL
		const pdfResponse = await fetch(pdfUrl);

		if (!pdfResponse.ok) {
			console.error(`Failed to fetch PDF: ${pdfResponse.statusText}`);
			return null;
		}

		const pdfBuffer = await pdfResponse.arrayBuffer();

		// Load the PDF document
		const pdfDoc = await PDFDocument.load(pdfBuffer);

		// Set the title in metadata if provided
		pdfDoc.setTitle(title || "");

		// Save and return the modified PDF
		const modifiedPdfBytes = await pdfDoc.save();
		return modifiedPdfBytes;
	} catch (error) {
		console.error("Error modifying PDF metadata:", error);
		return null;
	}
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

async function handleProxy(request: NextRequest, userId?: string | null) {
	const rateLimit = generateRateLimitObject(request, userId);

	if (request.nextUrl.pathname === "/") {
		return NextResponse.redirect(new URL("/lib", fixRequestUrl(request)));
	}

	const newRequest = mapLegacySearchParams(request);

	if (newRequest) {
		return newRequest;
	}

	// Check for redirections for item keys in URLs like /lib/{key}
	const libItemMatch = request.nextUrl.pathname.match(/\/lib\/([^\/]+)(.*)/);
	if (libItemMatch) {
		const key = libItemMatch[1] as keyof typeof redirections;
		const rest = libItemMatch[2] || "";
		const isZoteroKey = isLikelyZoteroKey(String(key));

		if (isZoteroKey) {
			try {
				const url = getInternalRequestUrl(
					request,
					`/api/item/${encodeURIComponent(key)}/redirects`
				).toString();

				const controller = new AbortController();
				const timeout = setTimeout(() => {
					controller.abort();
				}, 350);

				try {
					const response = await fetch(url, {
						signal: controller.signal,
						cache: "no-store",
					});

					const redirects = await response.json();

					if (redirects?.value && redirects.value !== key) {
						const newUrl = new URL(
							`/lib/${redirects.value}${rest}`,
							fixRequestUrl(request)
						);
						request.nextUrl.searchParams.forEach((value, paramKey) => {
							newUrl.searchParams.set(paramKey, value);
						});
						return NextResponse.redirect(newUrl, 301);
					}
				} finally {
					clearTimeout(timeout);
				}
			} catch (error) {
				const isExpectedAbort =
					error instanceof Error &&
					(error.name === "AbortError" ||
						// Node/DOM variants
						(error as any).code === "ABORT_ERR" ||
						(error as any).code === 20);

				if (!isExpectedAbort) {
					console.error("Error checking redirects:", error);
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
		const finalURL = new URL(
			`/api/item/${key}/export/${format}`,
			fixRequestUrl(request)
		);
		return setRateLimitHeaders(NextResponse.rewrite(finalURL), rateLimit);
	}

	const downloadMatch = request.nextUrl.pathname.match(
		/\/lib\/(.+?)\/download\/?(?:([^\/]+)(.*))?$/
	);
	if (downloadMatch) {
		const itemKey = downloadMatch[1];
		const attachmentKey = downloadMatch[2];

		if (!attachmentKey) {
			const itemPageUrl = new URL(
				`/lib/${itemKey}`,
				fixRequestUrl(request)
			);
			itemPageUrl.searchParams.set("message", "selectPDF");
			return NextResponse.redirect(itemPageUrl);
		}

		const itemUrl = getInternalRequestUrl(
			request,
			`/api/item/${itemKey}`
		).toString();

		try {
			const response = await fetch(itemUrl);

			if (!response.ok) {
				return NextResponse.json(
					{ error: `Failed to fetch item: ${response.statusText}` },
					{ status: response.status }
				);
			}

			let item: ItemGetResponse;
			try {
				item = await response.json();
			} catch (jsonError) {
				console.error("Error parsing JSON response:", jsonError);
				return NextResponse.json(
					{ error: "Failed to parse item data" },
					{ status: 500 }
				);
			}

			if (!item.item) {
				return NextResponse.json(
					{ error: "Item not found" },
					{ status: 404 }
				);
			}
			if (!item.item.attachmentsData) {
				return NextResponse.json(
					{ error: "Item or attachments not found" },
					{ status: 404 }
				);
			}
			const attachment = item.item.attachmentsData.find(
				(attachment) => attachment.key === attachmentKey
			);
			if (!attachment || !attachment.url) {
				const itemPageUrl = new URL(
					`/lib/${itemKey}`,
					fixRequestUrl(request)
				);
				itemPageUrl.searchParams.set("error", "PDFNotFound");
				return NextResponse.redirect(itemPageUrl);
			}

			// Check if this is a PDF by content type
			const isPDF = attachment.contentType?.toLowerCase().includes("pdf");

			if (isPDF) {
				// Modify PDF metadata with attachment title
				const modifiedPdf = await modifyPDFMetadata(
					attachment.url,
					attachment.title
				);

				if (modifiedPdf) {
					// Return the modified PDF - convert Uint8Array to Buffer
					const response = new NextResponse(
						Buffer.from(modifiedPdf),
						{
							status: 200,
							headers: {
								"Content-Type": "application/pdf",
								"Content-Disposition": `inline;`,
								"Item-Key": itemKey,
								"Attachment-Key": attachmentKey,
							},
						}
					);
					return setRateLimitHeaders(response, rateLimit);
				} else {
					// If modification failed, fall back to rewriting to the original URL
					console.warn(
						"PDF modification failed, falling back to original URL"
					);
					const finalURL = new URL(
						attachment.url,
						fixRequestUrl(request)
					);
					return setRateLimitHeaders(
						NextResponse.rewrite(finalURL),
						rateLimit
					);
				}
			} else {
				// For non-PDF attachments, just rewrite to the original URL
				const finalURL = new URL(
					attachment.url,
					fixRequestUrl(request)
				);
				return setRateLimitHeaders(
					NextResponse.rewrite(finalURL),
					rateLimit
				);
			}
		} catch (fetchError) {
			console.error("Fetch error:", fetchError);
			return NextResponse.json(
				{ error: "Failed to retrieve item data" },
				{ status: 500 }
			);
		}
	} else if (
		request.nextUrl.pathname === "/lib/atom.xml" ||
		(request.nextUrl.pathname.startsWith("/profile/") &&
			request.nextUrl.pathname.endsWith("/atom.xml"))
	) {
		const id = request.nextUrl.pathname.startsWith("/profile/")
			? request.nextUrl.pathname.split("/")[2]
			: "main";
		const finalURL = new URL(`/api/feed/${id}`, fixRequestUrl(request));
		request.nextUrl.searchParams.forEach((value, key) => {
			finalURL.searchParams.set(key, value);
		});
		return setRateLimitHeaders(NextResponse.rewrite(finalURL), rateLimit);
	} else if (request.nextUrl.pathname.startsWith("/api/")) {
		if (
			request.nextUrl.pathname.startsWith("/api/ai") &&
			!request.nextUrl.pathname.includes("embeddings")
		) {
			if (rateLimit) {
				const timeSinceFirstRequest =
					Date.now() - rateLimit.firstRequest;

				if (timeSinceFirstRequest < RESET_TIME) {
					rateLimit.count++;
				} else {
					rateLimit.count = 1;
					rateLimit.firstRequest = Date.now();
				}

				if (rateLimit.count >= AMOUNT_OF_REQUESTS) {
					return NextResponse.json(
						{ error: "Rate limit exceeded" },
						{ status: 403 }
					);
				}

				return setRateLimitHeaders(NextResponse.next(), rateLimit);
			} else {
				return NextResponse.json(
					{ error: "Unauthorized" },
					{ status: 401 }
				);
			}
		}
		return setRateLimitHeaders(NextResponse.next(), rateLimit);
	}

	const response = createMiddleware(routing)(request);

	return setRateLimitHeaders(response, rateLimit);
}

export default clerkMiddleware(async (auth, request) => {
	const { userId } = await auth();
	return handleProxy(request, userId);
});

export const config = {
	// Matcher entries are linked with a logical "or", therefore
	// if one of them matches, the middleware will be invoked.
	matcher: [
		// Match all pathnames except for specific prefixes, the public redirect lookup API, and file extensions
		"/((?!api/item/[^/]+/redirects|_next|_vercel|backend|.*\\..*).*)",
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
