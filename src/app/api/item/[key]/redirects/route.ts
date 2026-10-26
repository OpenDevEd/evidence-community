import { NextRequest, NextResponse } from "next/server";
import { cacheLife, cacheTag } from "next/cache";
import {
	PRIVATE_NO_STORE_CACHE_CONTROL,
	PUBLIC_READ_CACHE_CONTROL,
} from "@/lib/http-cache";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { readItemRedirect } from "@/lib/item-redirects";

function isLikelyZoteroKey(key: string) {
	return /^[A-Z0-9]{8}$/.test(key);
}

async function getCachedRedirectData(
	itemKey: string,
	configRevision: string,
	libraryConfig: LibraryServerConfig,
) {
	'use cache'
	cacheLife({ revalidate: 60 })
	cacheTag('redirect-' + configRevision + '-' + itemKey)
	const value = await readItemRedirect(libraryConfig, itemKey);
	if (!value) {
		throw new Error("Redirect not found");
	}

	return { value };
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
	if (!libraryConfig.generation.redirects) {
		return NextResponse.json(
			{ value: itemKey },
			{
				status: 200,
				headers: {
					"Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL,
				},
			},
		);
	}

	let redirects: { value: string };

	try {
		redirects = await getCachedRedirectData(
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
			"Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL,
		},
	});
}
