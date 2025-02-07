import { Item } from "@/app/api/item/types";
import { ITEMS_PER_PAGE } from "@/constants/items";
import { SCOPE_OPTIONS } from "@/constants/items";
import { SORT_OPTIONS } from "@/constants/items";

export const fetcher = (url: string) =>
	fetch(`/api${url}`).then((res) => res.json());

export const fetcherPOST = ([url, payload, headers]: [string, any, any]) =>
	fetch(`/api${url}`, {
		method: "POST",
		body: JSON.stringify(payload),
		headers: headers,
	}).then((res) => res.json());

export const setter = (url: string, { arg }: { arg: any }) =>
	fetch(`/api${url}`, {
		method: "POST",
		body: JSON.stringify(arg),
	});

export function defaultParams(searchParams: Record<string, string> | URLSearchParams) {
	const getParam = (key: string): string => {
		return searchParams instanceof URLSearchParams
			? searchParams.get(key) || ""
			: searchParams[key] || "";
	};

	const collectionsParam = getParam("collections");
	const collections = collectionsParam ? collectionsParam.split(",") : [];
	const page = Number(getParam("page")) || 1;
	const sort = getParam("sort") || SORT_OPTIONS[0].key;
	const search = getParam("search") || "";
	const scope = getParam("scope") || SCOPE_OPTIONS[0].key;
	const range = getParam("range") || "";
	const collectionId = getParam("collectionId") || "";

	return {
		page,
		sort,
		collections,
		search,
		scope,
		range,
		collectionId,
	};
}

export function buildItemsQuery(params: any, url: string = "/items"): string {
	const {
		page,
		sort,
		collections,
		search,
		scope,
		range,
		collectionId,
	} = params;

	const queryParts = [
		`page=${page}`,
		`sort=${sort}`,
		collections?.length > 0 && `collections=${collections.join(",")}`,
		search?.length > 0 && `search=${search}`,
		scope !== SCOPE_OPTIONS[0].key && `scope=${scope}`,
		range && `range=${range}`,
		collectionId && `collectionId=${collectionId}`,
	];

	return `${url}?${queryParts.filter(Boolean).join("&")}`;
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

	if (item.attachmentsData?.some(attachment => attachment.PDFCoverPageImage) || allowedInstitutions.includes(item.institution || "") || allowedTags.some(tag => item.tags?.includes(tag))) {
		return true;
	}

	return false;
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

