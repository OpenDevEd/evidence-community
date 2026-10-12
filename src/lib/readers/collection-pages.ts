/**
 * The lists of a reader's collections come from the server a page at a time. These are how many rows each list shows
 * and the addresses its pages are read from, shared by the server that renders a first page and the browser that
 * turns the rest.
 */

/** Collections on one page of a profile's column, its phone sheet and "Shared with you". */
export const PROFILE_COLLECTIONS_PER_PAGE = 6;
/** Collections on one page of the record picker. */
export const PICKER_COLLECTIONS_PER_PAGE = 5;

/** The parameters that have a value; nobody signed in is no viewer. */
function query(params: Record<string, string | number | null | undefined>) {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
	return search.toString();
}

/**
 * Who a page was read for. The server answers by who is signed in; each address names them only to keep what each
 * viewer was shown apart in the browser, so a sign-in or sign-out in another tab reads the pages again.
 */
type Viewer = { viewer: string | null };

/** A page of a reader's collections; with `collectionId` and no page, the page that collection is on. */
export const profileCollectionsKey = (userId: string, request: Viewer & { page?: number; collectionId?: string }) =>
	`/user/collections/${userId}?${query({ ...request, pageSize: PROFILE_COLLECTIONS_PER_PAGE })}`;

/** A page of the collections shared with the signed-in reader. */
export const sharedCollectionsKey = (request: Viewer & { page: number }) => `/reader/collections/shared?${query({ ...request, pageSize: PROFILE_COLLECTIONS_PER_PAGE })}`;

/** A page of the collections a record can go into. */
export const pickerCollectionsKey = (request: Viewer & { search: string; sort: "recent" | "name"; page: number; itemKey?: string }) =>
	`/reader/collections?${query({ ...request, search: request.search.trim(), pageSize: PICKER_COLLECTIONS_PER_PAGE })}`;

/** Whether an SWR key is a page of one of these lists, which any change to a collection reloads. */
export const isCollectionsKey = (key: unknown) => typeof key === "string" && (key.startsWith("/user/collections/") || key.startsWith("/reader/collections"));
