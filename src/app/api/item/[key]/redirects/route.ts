import { NextRequest, NextResponse } from "next/server";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { cacheLife, cacheTag } from "next/cache";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";

function encodeKey(key: string): string {
	return key.split('').map(char => {
		const code = char.charCodeAt(0);
		return code.toString(36); // Use base36 (0-9 and a-z)
	}).join('n'); // Use 'n' as separator since it's not used in base36
}

function isLikelyZoteroKey(key: string) {
	return /^[A-Z0-9]{8}$/.test(key);
}

async function getCachedRedirectData(
	encoding: string,
	indexKey: string,
	itemKey: string,
	configRevision: string,
	libraryConfig: LibraryServerConfig,
) {
	'use cache'
	cacheLife({ revalidate: 60 })
	cacheTag(
		'redirect-' +
			indexKey +
			'-' +
			configRevision +
			'-' +
			itemKey,
	)
	const { redirectsIndex } =
		await getMeilisearchForConfig(libraryConfig);
	const timeoutPromise = new Promise((_, reject) =>
		setTimeout(() => reject(new Error("Redirect lookup timeout")), 350)
	);

	const redirects = (await Promise.race([
		redirectsIndex.getDocument(encoding),
		timeoutPromise,
	])) as Record<string, unknown>;

	if (!redirects?.value) {
		throw new Error("Redirect not found");
	}

	return redirects;
}

export async function GET(
	_request: NextRequest,
	props: { params: Promise<{ key: string }> }
) {
	const params = await props.params;
	const { key: URIkey } = params;

	const itemKey = decodeURIComponent(URIkey);
	if (!isLikelyZoteroKey(itemKey)) {
		return NextResponse.json(
			{ value: itemKey },
			{
				status: 200,
				headers: {
					"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
				},
			}
		);
	}

	const libraryConfig = await getLibraryConfig();
	const indexKey = libraryConfig.services.search.index;
	const key = indexKey + "|" + itemKey;
	const encoding = encodeKey(key);

	let redirects: Record<string, unknown>;

	try {
		redirects = await getCachedRedirectData(
			encoding,
			indexKey,
			itemKey,
			libraryConfig.revision,
			libraryConfig,
		);
	} catch {
		// Keep timeout/not-found fallbacks uncached.
		redirects = { value: itemKey };
	}

	return NextResponse.json(redirects, {
		status: 200,
		headers: {
			"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
		},
	});
}
