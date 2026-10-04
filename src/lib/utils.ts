import { Item } from "@/app/api/item/types";
import { ITEMS_PER_PAGE } from "@/constants/items";
import { SORT_OPTIONS } from "@/constants/items";
import { loadSearchParams, resultParams, serializeSearchParams } from "./searchParams";
import { COUNTRIES, COUNTRY_PARAMS } from "@/constants/misc";

export function parseRequestLinks(value: string) {
	return value.split("\n").map((link) => link.trim()).filter(Boolean);
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
// error instead of letting res.json() crash on HTML. Failed responses must
// reject so SWR retains prior data and exposes its error state.
const parseJsonResponse = (res: Response) => {
	if (!res.ok) throw new Error(`Request failed with status ${res.status} for ${res.url}`);
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
	return `/facets${serializeSearchParams(resultParams(params))}`;
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


;


;

;
