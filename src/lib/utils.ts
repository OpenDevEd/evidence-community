import { ITEMS_PER_PAGE } from "@/constants/items";
import { SCOPE_OPTIONS } from "@/constants/items";

export const fetcher = (url: string) =>
	fetch(`/api${url}`).then((res) => res.json());
export const setter = (url: string, { arg }: { arg: any }) =>
	fetch(`/api${url}`, {
		method: "POST",
		body: JSON.stringify(arg),
	});

export function buildItemsQuery(params: any, url: string = "/items"): string {
	const {
		pageNumber,
		sort,
		collections,
		search,
		scope,
		range,
		collectionId,
	} = params;

	const queryParts = [
		`page=${pageNumber}`,
		`limit=${ITEMS_PER_PAGE}`,
		`sort=${sort}`,
		collections.length > 0 && `collections=${collections.join(",")}`,
		search.length > 0 && `search=${search}`,
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
		finalMap.set(key, reset.join(":"));
	}

	return finalMap;
}
