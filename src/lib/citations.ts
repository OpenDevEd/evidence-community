import { Item } from "@/app/api/item/types";
import { blockedTags } from "@/constants/misc";
import config from "@/constants/config.json";
import meilisearchClient from "@/lib/meilisearch";
import { ItemToZoteroJSON, ensureNoBlankItems, transformItem } from "@/lib/utils";
import { cacheLife } from "next/cache";
import { CiteProcSys, CSLItem, Engine } from "citeproc";

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
	"use cache";
	cacheLife({ revalidate: 60 * 60 * 24 });
	const url = new URL("https://raw.githubusercontent.com/citation-style-language/styles/master/apa.csl");
	const res = await fetch(url.toString());
	return res.text();
}

async function getLocaleXMLFor(locale: string): Promise<string> {
	"use cache";
	cacheLife({ revalidate: 60 * 60 * 24 });
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

export async function getCSL(item: Item) {
	"use cache";
	cacheLife({ revalidate: 60 });
	const zoteroItem = ItemToZoteroJSON(item);
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
		throw new Error(`Failed to generate CSL for item ${item.key}`);
	}

	const data = await res.json();
	return data ? ensureNoBlankItems(data[0]) : null;
}

async function getCitationSourceItem(key: string): Promise<Item | null> {
	try {
		const result = await meilisearchClient
			.index(process.env.MEILI_INDEX || config.index)
			.getDocument(key);

		const item = result as Item;
		if (!item || item.deleted || item?.tags?.some((tag: string) => blockedTags.includes(tag.toLowerCase()))) {
			return null;
		}

		return transformItem(item) as Item;
	} catch {
		return null;
	}
}

export async function getCitationForItemKey(key: string, lang: string = "en-GB") {
	"use cache";
	cacheLife({ revalidate: 60 });
	const normalizedLocale = normalizeLocale(lang);
	const item = await getCitationSourceItem(key);
	if (!item) {
		return null;
	}

	const csl = await getCSL(item);
	if (!csl) {
		return null;
	}

	return getCitationFromCSL(csl, normalizedLocale);
}
