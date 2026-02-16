import { Item } from "@/app/api/item/types";
import { blockedTags } from "@/constants/misc";
import config from "@/constants/config.json";
import meilisearchClient from "@/lib/meilisearch";
import { ItemToZoteroJSON, ensureNoBlankItems, transformItem } from "@/lib/utils";
import { unstable_cache } from "next/cache";
import { CiteProcSys, CSLItem, Engine } from "citeproc";

async function getStyle() {
	const cached = unstable_cache(async () => {
		const url = new URL("https://raw.githubusercontent.com/citation-style-language/styles/master/apa.csl");
		const res = await fetch(url.toString());
		return res.text();
	}, ["apa.csl"], {
		revalidate: 60 * 60 * 24,
	});

	return cached();
}

async function getLocaleXML(lang: string = "en-GB"): Promise<string> {
	const cached = unstable_cache(async () => {
		const url = `https://raw.githubusercontent.com/citation-style-language/locales/master/locales-${lang}.xml`;
		const res = await fetch(url);
		if (!res.ok) throw new Error("Failed to fetch locale");
		return res.text();
	}, ["locale", lang], {
		revalidate: 60 * 60 * 24,
	});

	return cached();
}

export async function getCitationFromCSL(csl: any, lang: string = "en-GB") {
	if (!csl?.id) {
		return null;
	}

	const [style, locale] = await Promise.all([getStyle(), getLocaleXML(lang)]);

	const items: Record<string, CSLItem> = { [csl.id]: csl };

	const sys: CiteProcSys = {
		retrieveLocale: () => locale,
		retrieveItem: (id: string) => items[id],
	};

	const citeproc = new Engine(sys, style, lang);
	citeproc.updateItems([csl.id]);

	const [, bibliography] = citeproc.makeBibliography();
	return bibliography && bibliography.length > 0 ? bibliography[0] : null;
}

export async function getCSL(item: Item) {
	const cached = unstable_cache(async () => {
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
	}, ["csl", String(item.id)], {
		revalidate: 60,
	});

	return cached();
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
	const cached = unstable_cache(async () => {
		const item = await getCitationSourceItem(key);
		if (!item) {
			return null;
		}

		const csl = await getCSL(item);
		if (!csl) {
			return null;
		}

		return getCitationFromCSL(csl, lang);
	}, ["item-citation", String(process.env.MEILI_INDEX || config.index), key, lang], {
		revalidate: 60,
	});

	return cached();
}
