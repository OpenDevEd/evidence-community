import meilisearch from "@/lib/meilisearch";
import { cacheLife } from "next/cache";
import config from "@/constants/config.json";

function encodeKey(key: string): string {
	return key
		.split("")
		.map((char) => {
			const code = char.charCodeAt(0);
			return code.toString(36);
		})
		.join("n");
}

export function isLikelyZoteroKey(key: string) {
	return /^[A-Z0-9]{8}$/.test(key);
}

async function getRedirectData(encoding: string): Promise<{ value: string }> {
	"use cache";
	cacheLife({ revalidate: 60 });

	const timeoutPromise = new Promise((_, reject) =>
		setTimeout(
			() => reject(new Error("Redirect lookup timeout")),
			350
		)
	);

	const redirects = (await Promise.race([
		meilisearch.index("redirects").getDocument(encoding),
		timeoutPromise,
	])) as Record<string, unknown>;

	if (!redirects?.value) {
		throw new Error("Redirect not found");
	}

	return redirects as { value: string };
}

/**
 * Look up a redirect for a Zotero item key.
 * Returns `{ value: string }` — the value equals the input key when no redirect exists.
 */
export async function getRedirect(
	itemKey: string
): Promise<{ value: string }> {
	if (!isLikelyZoteroKey(itemKey)) {
		return { value: itemKey };
	}

	const key =
		(process.env.MEILI_INDEX || config.index) + "|" + itemKey;
	const encoding = encodeKey(key);

	try {
		return await getRedirectData(encoding);
	} catch {
		return { value: itemKey };
	}
}
