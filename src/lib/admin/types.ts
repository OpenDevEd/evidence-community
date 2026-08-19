export type AdminRecordState = "deleted" | "draft" | "edited" | "published";

export type AdminFileState = "none" | "processing" | "staged" | "published";

export type AdminCreator = {
	creatorType: string;
	firstName?: string;
	lastName?: string;
	name?: string;
};

export type AdminItemSummary = {
	creators: AdminCreator[];
	date: string | null;
	fileState: AdminFileState;
	itemType: string;
	key: string;
	revision: number;
	sourceConnectionKey: string;
	state: AdminRecordState;
	title: string;
	updatedAt: string;
};

export type AdminItemListRow = AdminItemSummary & {
	collections: string[];
	creatorNames: string[];
	dateAdded: string | null;
	pageCount: number | null;
	tags: string[];
	year: number | null;
};

export type AdminItemDraft = {
	baseRevision: number;
	createdAt: string;
	draftRevision: number;
	itemKey: string;
	patch: Record<string, unknown>;
	payload: Record<string, unknown>;
	sourceConnectionKey: string;
	updatedAt: string;
};

export type AdminFileDraft = {
	actualSha256: string | null;
	actualSizeBytes: number | null;
	coverHeight: number | null;
	coverWidth: number | null;
	expectedSha256: string;
	expectedSizeBytes: number;
	filename: string;
	itemKey: string;
	pageCount: number | null;
	readyAt: string | null;
	updatedAt: string;
	uploadRevision: number;
};

export type AdminFilePublication = {
	coverPublicUrl: string;
	filename: string;
	itemKey: string;
	pageCount: number;
	publicUrl: string;
	publishedAt: string;
	sha256: string;
	sizeBytes: number;
	uploadRevision: number;
};

export type AdminAttachment = AdminItemSummary & {
	draft: AdminItemDraft | null;
	fileDraft: AdminFileDraft | null;
	filePublication: AdminFilePublication | null;
	parentItem: string;
	sourceFileUrl: string | null;
};

export type AdminItemDetail = AdminItemSummary & {
	attachments: AdminAttachment[];
	collectionKeys: string[];
	draft: AdminItemDraft | null;
	editable: boolean;
	fileDraft: AdminFileDraft | null;
	filePublication: AdminFilePublication | null;
	parentItem: string | null;
	parentState: AdminRecordState | null;
	published: Record<string, unknown> | null;
	publishedCollectionKeys: string[];
	publishedTags: string[];
	sourceFileUrl: string | null;
	tags: string[];
	writeback: AdminItemWriteback;
};

export type AdminItemWritebackReason =
	| "item-locked"
	| "not-linked"
	| "ok"
	| "source-disabled"
	| "source-paused"
	| "source-removed"
	| "unsupported-provider";

export type AdminItemWritebackTarget = {
	effective: boolean;
	isOrigin: boolean;
	itemEnabled: boolean;
	linkExists: boolean;
	provider: string;
	reason: AdminItemWritebackReason;
	sourceEnabled: boolean;
	sourceKey: string;
	sourceLabel: string;
	sourceStatus: string | null;
	supported: boolean;
};

/** The sources a record may write back to, and which ones the admin chose. */
export type AdminItemWriteback = {
	available: AdminItemWritebackTarget[];
	originSourceKey: string | null;
	selected: string[];
};

export type AdminCollection = {
	deleted: boolean;
	key: string;
	name: string;
	parentCollection: string | null;
	revision: number;
	sortOrder: number | null;
	sourceConnectionKey: string;
	updatedAt: string;
};

export type AdminCollectionCatalogEntry = AdminCollection & {
	ancestors: Array<{
		key: string;
		name: string;
	}>;
	hasChildren: boolean;
};

export type AdminCollectionCatalogPage = {
	hasMore: boolean;
	items: AdminCollectionCatalogEntry[];
	nextCursor: string | null;
};

export type AdminSource = {
	/** Active collections this source holds; tells the tree whether to offer a chevron. */
	collectionCount: number;
	key: string;
	label: string;
	provider: string;
	readOnly: boolean;
	status: string;
	writeback: {
		enabled: boolean;
		supported: boolean;
	};
};

export type AdminLibrarySnapshot = {
	sources: AdminSource[];
};

export type AdminItemListPage = {
	hasMore: boolean;
	items: AdminItemListRow[];
	nextCursor: string | null;
};

export type AdminItemViewFilters = {
	filters: import("./item-list-contract").AdminItemFilter[];
	query: string;
	sort: import("./item-list-contract").AdminItemSortColumnId;
	sortDirection: "asc" | "desc";
};
