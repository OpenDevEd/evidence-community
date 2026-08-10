import type { AdminCollectionCatalogEntry } from "@/lib/admin/types";
import { invalidateAdminCollectionResolutionCache } from "./admin-collection-resolution-cache";

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
