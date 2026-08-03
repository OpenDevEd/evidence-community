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

export function requestAdminCollectionFocus(collectionKey: string) {
	window.dispatchEvent(
		new CustomEvent<string>(ADMIN_COLLECTION_FOCUS_EVENT, {
			detail: collectionKey,
		}),
	);
}
import { invalidateAdminCollectionResolutionCache } from "./admin-collection-resolution-cache";
