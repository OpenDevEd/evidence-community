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
	kind: "created" | "imported";
	importMethod: "doi" | "file" | null;
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
	generation: string;
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
	fileRemovalPending: boolean;
	parentItem: string;
	sourceFileUrl: string | null;
};

export type AdminItemLinkKind = "cites" | "related";

/** A record on the other end of a link, with enough to show a row without another request. */
export type AdminLinkTarget = {
	deleted: boolean;
	itemType: string;
	key: string;
	title: string;
};

/** A link row that the editor cannot change here: it comes from a source or is a citation of this record. */
export type AdminLinkRow = {
	key: string;
	kind: AdminItemLinkKind;
	origin: string;
};

export type AdminItemLinkKeys = Record<AdminItemLinkKind, string[]>;

export type AdminItemLinks = {
	/** Records that cite this record (read-only here). */
	citedBy: AdminLinkRow[];
	/** Links owned by sources, read-only here: outgoing `cites`, and `related` in either direction. */
	fromSources: AdminLinkRow[];
	/** Editor-owned link keys as currently drafted: outgoing `cites`, `related` from both sides. */
	keys: AdminItemLinkKeys;
	/** Editor-owned link keys as published. */
	publishedKeys: AdminItemLinkKeys;
	/** Titles and states for every key named above. */
	targets: AdminLinkTarget[];
};

export type AdminItemDetail = AdminItemSummary & {
	kind: "created" | "imported";
	importMethod: "doi" | "file" | null;
	attachments: AdminAttachment[];
	collectionKeys: string[];
	draft: AdminItemDraft | null;
	editable: boolean;
	fileDraft: AdminFileDraft | null;
	filePublication: AdminFilePublication | null;
	fileRemovalPending: boolean;
	links: AdminItemLinks;
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

export type AdminSourceSyncStatus = "failed" | "idle" | "running" | "succeeded";

/** Import state of an external source, read from the sync tables. */
export type AdminSourceSync = {
	/** Records with a saved import issue, such as a field that was left out. */
	issueCount: number;
	lastError: string | null;
	lastFailureAt: string | null;
	/** Records the last successful import wrote. */
	lastRecords: number | null;
	lastSuccessAt: string | null;
	/** Records a running import has processed so far, when the source reports it. */
	processed: number | null;
	runningSince: string | null;
	status: AdminSourceSyncStatus;
};

export type AdminSourceIssuesPage = {
	/** Dismissed issues for the source, whichever view this page shows. */
	dismissedTotal: number;
	hasMore: boolean;
	issues: AdminSourceIssue[];
	nextCursor: string | null;
	/** Open (not dismissed) issues for the source; the sidebar badge shows this. */
	total: number;
};

export type AdminSourceIssue = {
	/** The attachment's filename when the issue is about a file under a record. */
	attachmentFilename: string | null;
	code: string;
	/** When an admin dismissed the issue; null while it is open. */
	dismissedAt: string | null;
	/** The library record to open: the parent when the issue is about its attachment. */
	itemKey: string | null;
	/** The worker's technical message; the admin shows a plain explanation first. */
	message: string;
	sourceRecordKey: string;
	title: string | null;
	updatedAt: string;
};

export type AdminSource = {
	/** Active collections this source holds; tells the tree whether to offer a chevron. */
	collectionCount: number;
	key: string;
	label: string;
	provider: string;
	readOnly: boolean;
	status: string;
	/** Null for the native source, which has nothing to import. */
	sync: AdminSourceSync | null;
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
