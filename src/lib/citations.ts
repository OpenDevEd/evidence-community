import { Item } from "@/app/api/item/types";
import config from "@/constants/config.json";
import meilisearchClient from "@/lib/meilisearch";
import { ItemToZoteroJSON, ensureNoBlankItems, transformItem } from "@/lib/utils";
import { cacheLife, cacheTag } from "next/cache";
import { CiteProcSys, CSLItem, Engine } from "citeproc";
import { getLibraryConfig } from "@/config/library-config/server";
import { hasAnyTag } from "@/lib/tags";

const DEFAULT_CITATION_LOCALE = "en-GB";
const LOCALE_ALIASES: Record<string, string> = {
	en: "en-GB",
	de: "de-DE",
	hi: "hi-IN",
	fr: "fr-FR",
	pt: "pt-PT",
	zh: "zh-CN",
	cn: "zh-CN",
};

function normalizeLocale(lang: string = DEFAULT_CITATION_LOCALE) {
	const raw = lang.trim().replace(/_/g, "-");
	if (!raw) {
		return DEFAULT_CITATION_LOCALE;
	}

	const lower = raw.toLowerCase();
	const directAlias = LOCALE_ALIASES[lower];
	if (directAlias) {
		return directAlias;
	}

	if (/^[a-z]{2}-[a-z]{2}$/i.test(raw)) {
		const [base, region] = raw.split("-");
		return `${base.toLowerCase()}-${region.toUpperCase()}`;
	}

	if (/^[a-z]{2}$/i.test(raw)) {
		return raw.toLowerCase();
	}

	return DEFAULT_CITATION_LOCALE;
}

async function getStyle() {
	'use cache'
	cacheLife({ revalidate: 60 * 60 * 24 })
	cacheTag('apa-csl')
	const url = new URL("https://raw.githubusercontent.com/citation-style-language/styles/master/apa.csl");
	const res = await fetch(url.toString());
	return res.text();
}

async function getLocaleXMLFor(locale: string): Promise<string> {
	'use cache'
	cacheLife({ revalidate: 60 * 60 * 24 })
	cacheTag('locale-' + locale)
	const url = `https://raw.githubusercontent.com/citation-style-language/locales/master/locales-${locale}.xml`;
	const res = await fetch(url);
	if (!res.ok) throw new Error("Failed to fetch locale");
	return res.text();
}

async function getLocaleXML(lang: string = DEFAULT_CITATION_LOCALE): Promise<{ locale: string; xml: string }> {
	const normalizedLocale = normalizeLocale(lang);
	const fallbackLocales = normalizedLocale === DEFAULT_CITATION_LOCALE
		? [normalizedLocale]
		: [normalizedLocale, DEFAULT_CITATION_LOCALE];

	for (const locale of fallbackLocales) {
		try {
			const xml = await getLocaleXMLFor(locale);
			return {
				locale,
				xml,
			};
		} catch {
			// Try next fallback locale.
		}
	}

	throw new Error("Failed to fetch citation locale");
}

export async function getCitationFromCSL(csl: any, lang: string = "en-GB") {
	if (!csl?.id) {
		return null;
	}

	const [{ locale: resolvedLocale, xml: locale }, style] = await Promise.all([
		getLocaleXML(lang),
		getStyle(),
	]);

	const items: Record<string, CSLItem> = { [csl.id]: csl };

	const sys: CiteProcSys = {
		retrieveLocale: () => locale,
		retrieveItem: (id: string) => items[id],
	};

	const citeproc = new Engine(sys, style, resolvedLocale);
	citeproc.updateItems([csl.id]);

	const [, bibliography] = citeproc.makeBibliography();
	return bibliography && bibliography.length > 0 ? bibliography[0] : null;
}

async function fetchCSL(zoteroItem: any, itemId: string) {
	const url = new URL(process.env.ZOTERO_TRANSLATION_SERVER_URL!);
	url.pathname = "export";
	url.searchParams.set("format", "csljson");

	const res = await fetch(url.toString(), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify([zoteroItem]),
	});

	if (!res.ok) {
		throw new Error(`Failed to generate CSL for item ${itemId}`);
	}

	const data = await res.json();
	return data ? ensureNoBlankItems(data[0]) : null;
}

export async function getCSL(item: Item) {
	const zoteroItem = ItemToZoteroJSON(item);
	return fetchCSL(zoteroItem, String(item.id));
}

async function getCitationSourceItem(
	key: string,
	hiddenTags: readonly string[],
): Promise<Item | null> {
	try {
		const result = await meilisearchClient
			.index(process.env.MEILI_INDEX || config.index)
			.getDocument(key);

		const item = result as Item;
		if (!item || item.deleted || hasAnyTag(item.tags, hiddenTags)) {
			return null;
		}

		return transformItem(item) as Item;
	} catch {
		return null;
	}
}

async function getCitationForItemKeyCached(
	indexKey: string,
	key: string,
	normalizedLocale: string,
	configRevision: string,
	hiddenTags: readonly string[],
) {
	'use cache'
	cacheLife({ revalidate: 60 })
	cacheTag('item-citation-' + key + '-' + normalizedLocale)
	const item = await getCitationSourceItem(key, hiddenTags);
	if (!item) {
		return null;
	}

	const csl = await getCSL(item);
	if (!csl) {
		return null;
	}

	return getCitationFromCSL(csl, normalizedLocale);
}

export async function getCitationForItemKey(key: string, lang: string = "en-GB") {
	const normalizedLocale = normalizeLocale(lang);
	const indexKey = String(process.env.MEILI_INDEX || config.index);
	const libraryConfig = await getLibraryConfig();
	return getCitationForItemKeyCached(
		indexKey,
		key,
		normalizedLocale,
		libraryConfig.revision,
		libraryConfig.content.tags.hidden,
	);
}
