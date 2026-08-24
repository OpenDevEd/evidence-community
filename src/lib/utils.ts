import { Item, ListItem } from "@/app/api/item/types";
import { ITEMS_PER_PAGE } from "@/constants/items";
import { SORT_OPTIONS } from "@/constants/items";
import { loadSearchParams, serializeSearchParams } from "./searchParams";
import { COUNTRIES, COUNTRY_PARAMS, CSL_SKIP_WORDS } from "@/constants/misc";
import { z } from "zod";
import { areLinksValid } from "./actions";
import { describeZoteroItemTypeFields } from "@opendeved/evidence-library-core/zotero-schema";
import balanced from "balanced-match";

export const takedownRequestSchema = z.object({
	email: z.string().email(),
	links: z.array(z.string().url()),
	description: z.string().min(20),
});

export async function validateTakedownRequest(email: string, links: string[], description: string): Promise<{ error: string } | { success: boolean }> {
	const result = takedownRequestSchema.safeParse({ email, links, description });
	if (!result.success) {
		return { error: result.error.message };
	}

	const linksValid = await areLinksValid(result.data.links);
	if (!linksValid) {
		return { error: "Invalid links" };
	}

	return { success: true };
}

export const contactRequestSchema = z.object({
	email: z.string().email(),
	description: z.string().min(20),
});

export async function validateContactRequest(email: string, description: string): Promise<{ error: string } | { success: boolean }> {
	const result = contactRequestSchema.safeParse({ email, description });
	if (!result.success) {
		return { error: result.error.message };
	}

	return { success: true };
}

export function getCountryInfo(country: string) {
	const parts = country.split(" > ");
	const lastPart = parts.pop() || "";
	const countryName = COUNTRIES[lastPart];
	const numberOfParts = parts.length;
	const label = countryName ? `${countryName} (${lastPart})` : lastPart;

	return {
		countryName: countryName,
		countryCode: lastPart,
		label: label,
		numberOfParts: numberOfParts,
	}
}

export function localizeOrUseIfCapitalized(label: string, t: any) {
	return label.charAt(0).toUpperCase() === label.charAt(0) ? label : t(label);
}

export function formatRange(range: string | null) {
	if (!range) return null;

	const [start, end] = range.includes("-")
		? range.split("-")
		: [range, range];
	const startYear = start ? Number(start) : null;
	const endYear = end ? Number(end) : null;

	if ((startYear === null || isNaN(startYear)) &&
		(endYear === null || isNaN(endYear))) return null;

	if (startYear === endYear && startYear !== null) return `year = ${startYear}`;

	return [
		startYear !== null && startYear > 0 && `year >= ${startYear}`,
		endYear !== null && endYear > 0 && `year <= ${endYear}`,
	].filter(Boolean).join(" AND ");
}

// Non-JSON here means the request never reached the API route (proxy or CDN
// error page, browser-check challenge, rate limit) — surface a controlled
// error instead of letting res.json() crash on HTML. JSON error payloads on
// non-2xx responses still parse as before.
const parseJsonResponse = (res: Response) => {
	const contentType = res.headers.get("content-type") ?? "";
	if (!contentType.includes("application/json")) {
		throw new Error(
			`Expected JSON from ${res.url} but got ${res.status} ${contentType || "(no content type)"}`
		);
	}
	return res.json();
};

export const fetcher = (url: string) =>
	fetch(`/api${url}`).then(parseJsonResponse);

export const fetcherExternal = (url: string) =>
	fetch(url).then(parseJsonResponse);

export const fetcherPOST = ([url, payload, headers]: [string, any, any]) =>
	fetch(`/api${url}`, {
		method: "POST",
		body: JSON.stringify(payload),
		headers: headers,
	}).then(parseJsonResponse);

export const fetcherDELETE = (url: string) =>
	fetch(`/api${url}`, {
		method: "DELETE",
	}).then(parseJsonResponse);

export const setter = (url: string, { arg }: { arg: any }) =>
	fetch(`/api${url}`, {
		method: "POST",
		body: JSON.stringify(arg),
	});

export function defaultParams(searchParams: Record<string, string> | URLSearchParams) {
	const defaults = loadSearchParams(searchParams);

	return defaults;
}

export function buildItemsQuery(params: any, url: string = "/items"): string {
	const serializedParams = serializeSearchParams(params);

	return `${url}${serializedParams}`;
}

export function buildFacetsQuery(params: any): string {
	// Facets depend on the filters, not on page/sort — dropping them keeps the
	// SWR key stable across pagination and sorting so the request edge-caches.
	const { page, sort, ...facetParams } = params;
	return `/facets${serializeSearchParams(facetParams)}`;
}

export function firstNonNullOrEmpty<T>(
	obj: T,
	keys: (keyof T)[]
): string | null {
	return obj[
		keys.find((key) => obj[key] !== null && obj[key] !== "") as keyof T
	] as string | null;
}

export function getExtraValues(extraUnsplit: string) {
	const pairs = extraUnsplit.split("\n");
	const finalMap: Map<string, string> = new Map();

	for (const pair of pairs) {
		const [key, ...reset] = pair.split(":");
		finalMap.set(key, reset.join(":").trim());
	}

	return finalMap;
}

export function unescapeXML(safe: string) {
	return safe
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

export function cleanAIResponse(response: string) {

	// General regex to match any characters in brackets followed by /lib/ paths
	const linkRegex = /\[(.*?)\](?:\(|\[)(\/lib\/[^)\]]+)(?:\)|\])([.,;:!?]*)/g;

	// If no links, return the original response
	if (!response.match(linkRegex)) return response;

	const seenPaths = new Set();

	// Replace links based on their path component
	const result = response.replace(linkRegex, (match, label, path, punctuation) => {
		if (!seenPaths.has(path)) {
			seenPaths.add(path);
			return `[${label}](${path})`; // Keep first occurrence but remove trailing punctuation
		}
		return ''; // Remove duplicate links
	});

	return result;
}

export function convertToImageURL(url: string) {
	return url;
}

export function getCountryAncestry(country: string) {
	const ancestry: string[] = [];
	const countryParams = country.includes(" > ") ? country : COUNTRY_PARAMS[country] || country;
	const parts = countryParams.split(" > ");

	for (let i = 0; i < parts.length; i++) {
		ancestry.push(parts.slice(0, i + 1).join(" > "));
	}

	return ancestry;
}

type ZoteroItem = Record<string, unknown> & { itemType: string };

export function ItemToZoteroJSON(item: Item): ZoteroItem {
	const { attachmentsData, citation, createdAt, updatedAt, deleted, deletedAt, collectionsData, collectionsAncestry, fullTextPDFs, institution: institutionArray, fullNames, dateSortKey, year, datePublished, provider, sourceExternalScopeKey, sourceConnectionKey, sourceRecordKey, revision, tags, ...rest } = item;

	const finalCountry = Array.isArray(item.country) ? item.country.join("|") : item.country;
	const finalInstitution = Array.isArray(item.institution) ? item.institution.join("|") : item.institution;

	const zoteroItem: ZoteroItem = {
		...rest,
		itemType: item.itemType[0]!.toLowerCase() + item.itemType.slice(1),
	};
	for (const { field, semanticField } of describeZoteroItemTypeFields(
		zoteroItem.itemType,
	)) {
		const internalField =
			semanticField === "language" ? "languageName" : semanticField;
		const value = item[internalField as keyof Item];
		delete zoteroItem[internalField];
		if (value !== null && value !== undefined) zoteroItem[field] = value;
	}

	const country = finalCountry?.split("|").map(c => c.trim());
	zoteroItem.country = country ? country[0] : null;

	const institution = finalInstitution?.split("|").map(c => c.trim());
	if (institution?.[0] && "institution" in zoteroItem) {
		zoteroItem.institution = institution[0];
	}

	return zoteroItem;
}

export function isSentenceCase(val: any) {
	const matches = val.match(/^\W*(\w+)(.*?)$/);
	if (matches && matches.length > 2) {
		const [_, firstWord] = matches;
		let remainingWords = matches[2];
		const firstLetter = firstWord.substr(0, 1);
		if (firstLetter.toUpperCase() !== firstLetter) {
			// first letter of first word is not uppercase
			return false;
		}
		// count how many words are lowercased, ignoring short words and SKIP_WORDS
		let lowerCaseWords = 0;
		let totalWords = 0;
		remainingWords = remainingWords.match(/(\w+)/g);
		if (remainingWords) {
			remainingWords
				.filter((word: string) => word.length >= 4 || !CSL_SKIP_WORDS.includes(word))
				.forEach((word: string) => {
					totalWords++;
					const firstLetter = word.substr(0, 1);
					if (firstLetter.toLowerCase() === firstLetter) {
						lowerCaseWords++;
					}
				});
		}
		const ratio = lowerCaseWords / totalWords;
		return ratio >= 0.5;
	}
}

export function processSentenceCase(val: any) {
	if (isSentenceCase(val)) {
		return val;
	}
	const matches = val.match(/(([^.!?]+)[.!?]+)|([^.!?]+$)/g);
	if (matches) {
		return matches.map((s: string) => {
			// skip special characters at the beginning of the sentence
			const match = s.trim().match(/^(['"¡¿"'„«(]*)(.*)$/);
			if (!match) return s;
			const [_, pre, sentence] = match;
			// uppercase first actual letter of the sentence, lowercase rest
			return pre + sentence[0].toUpperCase() + sentence.slice(1).toLowerCase();
		})
			.join(' ');
	} else {
		return val;
	}
};


export function processSentenceCaseAPAField(value: string): string {
	var match;
	var sentencesInBrackets = [];
	var rootSentences = '';
	// extract all content in balanced parentheses
	while ((match = balanced('(', ')', value))) {
		match.body = processSentenceCase(match.body);
		// process sentences within parentheses
		sentencesInBrackets.push(match);
		rootSentences += match.pre;
		value = match.post;
	}
	rootSentences += value;
	// process "root" sentences separately
	rootSentences = processSentenceCase(rootSentences);

	// re-insert content from parentheses at correct indexes
	var pointer = 0;
	sentencesInBrackets.forEach(sentenceInBrackets => {
		const pre = rootSentences.substr(0, pointer + sentenceInBrackets.start);
		const post = rootSentences.substr(pointer + sentenceInBrackets.start);

		rootSentences = `${pre}(${sentenceInBrackets.body})${post}`;
		pointer += sentenceInBrackets.end + 1;
	});
	return rootSentences;
};

export function processSentenceCaseAPAItems(item: ZoteroItem) {
	const whitelist = [
		'title',
		'shortTitle',
	];

	(Object.keys(item) as Array<keyof ZoteroItem>).forEach((k) => {
		if (typeof (item[k]) === 'string' && whitelist.includes(k)) {
			(item as any)[k] = processSentenceCaseAPAField(item[k] as string);
		}
	});

	return item;
};

export function transformItem(item: Item | undefined): Item | null;
export function transformItem(item: ListItem | undefined): ListItem | null;
export function transformItem<T extends Item | ListItem>(item: T | undefined): T | null {
	if (!item) return null;
	const ExtraValues = getExtraValues(item.extra || "");

	const rawDoi = item.DOI || ExtraValues.get("DOI") || null;
	item.DOI = rawDoi?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "") ?? null;

	return item;
}
