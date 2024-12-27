import { ITEMS_PER_PAGE } from "@/constants/items";
import { SCOPE_OPTIONS } from "@/constants/items";

export const fetcher = (url: string) => fetch(`/api${url}`).then(res => res.json())
export const setter = (url: string, { arg }: { arg: any }) => fetch(`/api${url}`, {
	method: "POST",
	body: JSON.stringify(arg),
})

export function buildItemsQuery(params: any): string {
	const { pageNumber, sort, collections, search, scope, range } = params;

	const queryParts = [
		`page=${pageNumber}`,
		`limit=${ITEMS_PER_PAGE}`,
		`sort=${sort}`,
		collections.length > 0 && `collections=${collections.join(",")}`,
		search.length > 0 && `search=${search}`,
		scope !== SCOPE_OPTIONS[0].key && `scope=${scope}`,
		range && `range=${range}`,
	];

	return `/items?${queryParts.filter(Boolean).join("&")}`;
}

export function firstNonNullOrEmpty<T>(
	obj: T,
	keys: (keyof T)[]
): string | null {
	return obj[
		keys.find((key) => obj[key] !== null && obj[key] !== "") as keyof T
	] as string | null;
}
