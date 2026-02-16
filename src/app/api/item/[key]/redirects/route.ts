import { NextRequest, NextResponse } from "next/server";
import meilisearch from "@/lib/meilisearch";
import { unstable_cache } from "next/cache";
import config from "@/constants/config.json";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";

function encodeKey(key: string): string {
	return key.split('').map(char => {
		const code = char.charCodeAt(0);
		return code.toString(36); // Use base36 (0-9 and a-z)
	}).join('n'); // Use 'n' as separator since it's not used in base36
}

export async function GET(
	_request: NextRequest,
	props: { params: Promise<{ key: string }> }
) {
	const params = await props.params;
	const { key: URIkey } = params;

	const itemKey = decodeURIComponent(URIkey);
	const key = (process.env.MEILI_INDEX || config.index) + "|" + itemKey;
	const encoding = encodeKey(key);

	const getRedirectData = unstable_cache(
		async () => {
			try {
				const timeoutPromise = new Promise((_, reject) =>
					setTimeout(() => reject(new Error("Redirect lookup timeout")), 350)
				);

				const redirects = (await Promise.race([
					meilisearch.index("redirects").getDocument(encoding),
					timeoutPromise,
				])) as Record<string, unknown>;

				if (redirects?.value) {
					return redirects;
				}
			} catch {
				// Safe fallback below
			}

			return { value: itemKey };
		},
		["redirects", String(process.env.MEILI_INDEX || config.index), itemKey],
		{
			revalidate: 60,
		}
	);

	const redirects = await getRedirectData();

	return NextResponse.json(redirects, {
		status: 200,
		headers: {
			"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
		},
	});
}
