import type { AdminCollectionCatalogEntry } from "@/lib/admin/types";
import { forgetResolvedAdminCollections, invalidateAdminCollectionResolutionCache } from "./admin-collection-resolution-cache";

export const ADMIN_COLLECTION_EXPANSION_EVENT = "admin-collection-expansion";
export const ADMIN_COLLECTION_FOCUS_EVENT = "admin-collection-catalogue-focus";
export const ADMIN_COLLECTION_INVALIDATION_EVENT =
	"admin-collection-catalogue-invalidation";

export function requestAdminCollectionExpansion(collectionKeys: string[]) {
	window.dispatchEvent(
		new CustomEvent<string[]>(ADMIN_COLLECTION_EXPANSION_EVENT, {
			detail: collectionKeys,
		}),
	);
}

export function requestAdminCollectionCatalogueInvalidation() {
	invalidateAdminCollectionResolutionCache();
	window.dispatchEvent(new Event(ADMIN_COLLECTION_INVALIDATION_EVENT));
}

const ADMIN_COLLECTIONS_CHANGED_ELSEWHERE_EVENT = "admin-collections-changed-elsewhere";

/**
 * Someone else added, renamed, moved or removed a collection. What is kept about collections, their names on records
 * and the picker's pages, is read again. The tree doesn't start over as it does for a change made here: it reads
 * itself again in place.
 */
export function noteAdminCollectionsChangedElsewhere() {
	forgetResolvedAdminCollections();
	window.dispatchEvent(new Event(ADMIN_COLLECTIONS_CHANGED_ELSEWHERE_EVENT));
}

/** Calls `listener` whenever collections change, here or on someone else's screen. Returns how to stop. */
export function onAdminCollectionsChanged(listener: () => void) {
	window.addEventListener(ADMIN_COLLECTION_INVALIDATION_EVENT, listener);
	window.addEventListener(ADMIN_COLLECTIONS_CHANGED_ELSEWHERE_EVENT, listener);
	return () => {
		window.removeEventListener(ADMIN_COLLECTION_INVALIDATION_EVENT, listener);
		window.removeEventListener(ADMIN_COLLECTIONS_CHANGED_ELSEWHERE_EVENT, listener);
	};
}

export type AdminCollectionFocusRequest = {
	entry?: AdminCollectionCatalogEntry;
	key: string;
};

export function requestAdminCollectionFocus(
	request: AdminCollectionFocusRequest,
) {
	window.dispatchEvent(
		new CustomEvent<AdminCollectionFocusRequest>(
			ADMIN_COLLECTION_FOCUS_EVENT,
			{
				detail: request,
			},
		),
	);
}
