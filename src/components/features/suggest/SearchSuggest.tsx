"use client";

import { use } from "react";
import { ItemsContext } from "@/context/ItemsContext";
import { PaperNamed } from "./PaperNamed";
import { namesPaper } from "./papers";
import { SuggestButton } from "./SuggestPapers";

/** Whether the list is the community's own search, not a reader's collection: its papers are the ones anyone can add to. */
const ownSearch = (items: { userData?: unknown }) => !items.userData;

/** Above the community's own results: the paper its search names, if it names one. */
export function SearchedPaper() {
	const items = use(ItemsContext);
	return ownSearch(items) ? <PaperNamed search={items.queryParams.search ?? ""} /> : null;
}

/**
 * Beside the search's own buttons, on the community's results. A search that found nothing offers it in the list's
 * place, so not here as well.
 */
export function SuggestBesideSearch() {
	const items = use(ItemsContext);
	const found = items.itemsData?.items.length !== 0;
	return ownSearch(items) && found ? <SuggestButton /> : null;
}

/** Under the community's own search that found nothing. One that names a paper already offers that paper above. */
export function SuggestUnderEmpty() {
	const items = use(ItemsContext);
	const named = namesPaper(items.queryParams.search ?? "");
	return ownSearch(items) && !named ? <SuggestButton small /> : null;
}
