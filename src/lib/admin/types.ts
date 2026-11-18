import type { RemovalDoi } from "./removal-doi";
import type { StudyReading } from "@/lib/readings/study-types";
import type { SourceStatus } from "@/lib/source-ingestion/source-status";

import type { SourceFieldConflict } from "./source-field-contract";
export type AdminRecordState = "deleted" | "draft" | "edited" | "published";

/** `unpublished`: a source PDF the library doesn't publish. */
export type AdminFileState = "none" | "unpublished" | "processing" | "staged" | "published";

export type AdminCreator = {
	authorProfileId?: string;
	/** Where the author worked. The country comes from `institutionCountry`. */
	institutions?: { display_name?: string }[];
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

/**
 * Where a record's latest submitted version stands, when that is what a person needs to know about it: waiting for an
 * editor, or sent back. A paper someone added is declined, not sent back for changes.
 */
export type AdminRowReview = "pending" | "returned" | "declined";

export type AdminItemListRow = AdminItemSummary & {
	kind: "created" | "imported";
	review: AdminRowReview | null;
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

/** A Zotero attachment's PDF: the tags its source publishes PDFs by, and the library's choice for this one. */
export type AdminSourcePdf = {
	/** The tags that publish it in Zotero; null when its source publishes every PDF. */
	publishTags: string[] | null;
	choice: "publish" | "withhold" | null;
	/** The change in the working draft. */
	pending: "publish" | "withhold" | null;
	/** A pending review holds the change. */
	inReview: boolean;
	/** False from approval until the source's import has applied the choice. */
	applied: boolean;
	/** The source adds PDFs at all; off, none is published, by a tag or a choice. */
	pdfsOn: boolean;
};

export type AdminAttachment = AdminItemSummary & {
	draft: AdminItemDraft | null;
	sourcePdf: AdminSourcePdf | null;
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

/** The AI checks a PDF import read a record's PDF against, with the suggested changes that meet some of them. */
export type AdminItemChecks = {
	checks: import("./item-import-contract").PdfCheckResult[];
	filename: string;
	readAt: string;
	suggestions: { checks: number[]; field: string; value: string }[];
};

export type AdminItemDetail = AdminItemSummary & {
	/** The checks its PDF was read against, while it is still the PDF a PDF import gave it. */
	importChecks: AdminItemChecks | null;
	sourceFields: SourceFieldConflict[];
	importedTopics: {topicId: string; score: number; primary: boolean}[];
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
	/** The OpenAlex work it is, for its page on Openscholar; null when no OpenAlex source holds it. */
	openalexId: string | null;
	/** Its review's record (it, or the record it's attached to) is a paper someone sent: the team declines it. */
	addedPaper: boolean;
	/** What OpenAlex says about a published record's open access, whatever an editor chose; null when it has no answer. */
	openAccessFromSources: boolean | null;
	/** What the reading found the record to be, whatever an editor chose; null before it is read. */
	readingStudyType: StudyReading | null;
	parentItem: string | null;
	parentState: AdminRecordState | null;
	published: Record<string, unknown> | null;
	publishedCollectionKeys: string[];
	publishedTags: string[];
	/** What removing it does to its DOI, from its active DOI targets in every environment; absent reads as none. */
	removalDoi?: RemovalDoi;
	sourceFileUrl: string | null;
	sourcePdf: AdminSourcePdf | null;
	/** The record or one of its attachments holds a Zotero PDF change no review has yet. */
	sourcePdfChangePending: boolean;
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

export type AdminSourceIssueKind = "pdf" | "fields" | "large" | "other";

/** One kind of record issue in a source, with what to do about all of them. */
export type AdminSourceIssueType = {
	key: string;
	kind: AdminSourceIssueKind;
	title: string;
	next: string;
	count: number;
};

/** Where else a record can be opened: in its source, and on the public site. */
export type AdminSourceIssueLink = {
	kind: "zotero-app" | "zotero-web" | "openalex" | "public";
	href: string;
};

export type AdminSourceIssue = {
	sourceRecordKey: string;
	/** The library record to open: the parent when the issue is about its attachment. */
	itemKey: string | null;
	links: AdminSourceIssueLink[];
	title: string;
	/** Who and when, such as "Piper et al. 2018". */
	meta: string | null;
	/** What went wrong on this record, such as the field that was left out. */
	detail: string | null;
	/** The importer's technical message. */
	message: string;
};

export type AdminSourceIssuePage = { count: number; issues: AdminSourceIssue[] };

export type AdminSource = {
	/** Import and search state; null for the native source, which has nothing to import. */
	activity: SourceStatus | null;
	/** Active collections this source holds; tells the tree whether to offer a chevron. */
	collectionCount: number;
	/** The Zotero group or user id; null for sources without one. */
	externalScopeKey: string | null;
	key: string;
	label: string;
	provider: string;
	readOnly: boolean;
	scopeKind: string;
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
	reviewQueue: boolean;
	filters: import("./item-list-contract").AdminItemFilter[];
	query: string;
	sort: import("./item-list-contract").AdminItemSortColumnId;
	sortDirection: "asc" | "desc";
};
