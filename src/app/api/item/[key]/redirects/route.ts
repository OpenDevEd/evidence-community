import { NextRequest, NextResponse } from "next/server";
import meilisearch from "@/lib/meilisearch";
import { cacheLife, cacheTag } from "next/cache";
import config from "@/constants/config.json";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";

function encodeKey(key: string): string {
	return key.split('').map(char => {
		const code = char.charCodeAt(0);
		return code.toString(36); // Use base36 (0-9 and a-z)
	}).join('n'); // Use 'n' as separator since it's not used in base36
}

function isLikelyZoteroKey(key: string) {
	return /^[A-Z0-9]{8}$/.test(key);
}

async function getCachedRedirectData(encoding: string, indexKey: string, itemKey: string) {
	'use cache'
	cacheLife({ revalidate: 60 })
	cacheTag('redirect-' + indexKey + '-' + itemKey)
	const timeoutPromise = new Promise((_, reject) =>
		setTimeout(() => reject(new Error("Redirect lookup timeout")), 350)
	);

	const redirects = (await Promise.race([
		meilisearch.index("redirects").getDocument(encoding),
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

	const indexKey = process.env.MEILI_INDEX || config.index;
	const key = indexKey + "|" + itemKey;
	const encoding = encodeKey(key);

	let redirects: Record<string, unknown>;

	try {
		redirects = await getCachedRedirectData(encoding, indexKey, itemKey);
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
