import { Item } from "@/app/api/item/types";
import { getCachedItem } from "@/app/api/cache";
import { ItemToZoteroJSON } from "@/lib/utils";
import { cacheLife, cacheTag } from "next/cache";
import { CiteProcSys, CSLItem, Engine } from "citeproc";
import { getLibraryConfig } from "@/config/library-config/server";
import {
	translateZoteroItemToCSL,
} from "@/lib/zotero-translation";

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

async function getCSL(
	item: Item,
	translationUrl: string,
) {
	const zoteroItem = ItemToZoteroJSON(item);
	return translateZoteroItemToCSL(
		zoteroItem,
		item.key,
		translationUrl,
	);
}

export async function getCitationForItemKey(key: string, lang: string = "en-GB") {
	const normalizedLocale = normalizeLocale(lang);
	const libraryConfig = await getLibraryConfig();
	const translationUrl = libraryConfig.services.zotero.translationUrl;
	if (!translationUrl) {
		return null;
	}

	const { item } = await getCachedItem(key);
	if (!item) {
		return null;
	}

	const csl = await getCSL(item, translationUrl);
	if (!csl) {
		return null;
	}

	return getCitationFromCSL(csl, normalizedLocale);
}
