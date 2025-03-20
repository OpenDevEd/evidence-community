import { Item, ItemGetResponse } from "@/app/api/item/types";
import { ITEMS_PER_PAGE } from "@/constants/items";
import { SCOPE_OPTIONS } from "@/constants/items";
import { SORT_OPTIONS } from "@/constants/items";
import { loadSearchParams, serializeSearchParams } from "./searchParams";

export function convertStringFromDatabaseToObject(string: string) {
	if (!string) return {};

	const companyLogoStyleObject = string.split(",").reduce((acc: Record<string, string>, curr: string) => {
		const [key, value] = curr.split("|").map(s => s.trim());
		acc[key] = value;
		return acc;
	}, {});
	
	return companyLogoStyleObject || {}
}

export function getDynamicStyles(cssString: string): React.CSSProperties {
	if (!cssString) return {};
	
	// Handle CSS string like "width: 100px; height: 50px;"
	const styleObj: Record<string, string> = {};
	const styles = cssString.split(';');
	
	styles.forEach(style => {
		const [property, value] = style.split(':').map(s => s.trim());
		if (property && value) {
			// Convert kebab-case to camelCase for React
			const camelProperty = property.replace(/-([a-z])/g, (_, letter) => 
				letter.toUpperCase()
			);
			styleObj[camelProperty] = value;
		}
	});

	console.log(styleObj);
	
	return styleObj as React.CSSProperties;
}

export function cleanItemForAI(item: ItemGetResponse["item"] | undefined) {
	if (!item) return null;
	return {
		...item,
		fullTextPDFs: undefined,
		tags: undefined,
		collectionsAncestry: undefined,
		fullNames: undefined,
		collections: undefined,
		collectionsData: item.collectionsData?.map(({ name, title }) => ([title, name].filter(Boolean).join(" > "))),
		attachmentsData: item.attachmentsData?.map(({ filename, url }) => ({
			filename,
			url,
		})),
	}
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

export const fetcher = (url: string) =>
	fetch(`/api${url}`).then((res) => res.json());

export const fetcherPOST = ([url, payload, headers]: [string, any, any]) =>
	fetch(`/api${url}`, {
		method: "POST",
		body: JSON.stringify(payload),
		headers: headers,
	}).then((res) => res.json());

export const fetcherDELETE = (url: string) =>
	fetch(`/api${url}`, {
		method: "DELETE",
	}).then((res) => res.json());

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

export function isAIAllowed(item: Item | undefined) {
	if (!item) return false;
	const allowedInstitutions = ["EdTech Hub", "Open Development & Education", "eEkitabu"];
	const allowedTags = ["_ai_enabled"]

	if (item.attachmentsData?.some(attachment => attachment.PDFCoverPageImage) || 
	    (Array.isArray(item.institution) 
	      ? item.institution.some(inst => allowedInstitutions.includes(inst))
	      : allowedInstitutions.includes(item.institution || "")) || 
	    allowedTags.some(tag => item.tags?.includes(tag))) {
		return true;
	}

	return false;
}

export function generateRandomID(length: number = 12) {
	return Math.random().toString(36).substring(2, 2 + length);
}

export function escapeXml(unsafe: string) {
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
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
	return process.env.BASE_URL + "/images/" + url.split("/").slice(8).join("/");
}
