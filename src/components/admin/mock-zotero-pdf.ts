"use client";

/**
 * Mock only, never merged. A Zotero PDF's change in this library (publish it, or take it down) as the admin's own
 * file changes: a staged PDF or a PDF removal in the draft, submitted with the record, approved in the Review queue.
 * Everything the server doesn't do yet lives here, in this browser's session: the changes, the reviews, and what an
 * approval decided. `?pdfs=every` stands in for the source's "Every PDF" setting.
 */
import { publishedAdminItemPayload } from "@/lib/admin/item-draft-patch";
import type { AdminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import type { AdminAttachment, AdminItemDetail, AdminItemDraft, AdminItemListRow } from "@/lib/admin/types";
import type { SavedReview } from "@/lib/admin/review-contract";

/** USAID's publish tags; the real ones are the source's own setting. */
export const MOCK_PUBLISH_TAGS = ["_publish", "publishPDF"];

type Change = "publish" | "takeDown";
type Entry = { parentKey: string; change: Change | null; decided: "published" | "takenDown" | null };
type Review = {
	id: string;
	itemKey: string;
	title: string;
	state: "pending" | "published" | "returned" | "withdrawn";
	revision: number;
	submittedAt: string;
	resolvedAt: string | null;
	note: string | null;
	changes: { itemKey: string; change: Change }[];
};
type Store = { entries: Record<string, Entry>; reviews: Review[] };

const STORAGE_KEY = "mock-zotero-pdf";
function read(): Store {
	if (typeof window === "undefined") return { entries: {}, reviews: [] };
	return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{"entries":{},"reviews":[]}') as Store;
}
function write(store: Store) {
	sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

const every = () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("pdfs") === "every";

function isZoteroPdf(record: { itemType: string; sourceConnectionKey: string }, payload: Record<string, unknown> | null) {
	return record.itemType === "Attachment" && record.sourceConnectionKey.startsWith("zotero-") && payload?.contentType === "application/pdf";
}

/** Whether the source's rule publishes it: every PDF, or one with a publish tag. */
export function publishedByRule(tags: readonly string[]) {
	return every() || MOCK_PUBLISH_TAGS.some((tag) => tags.includes(tag));
}

export function isMockZoteroPdf(key: string) {
	return key in read().entries;
}

export function mockZoteroPdfRule(detail: AdminItemDetail) {
	if (!isMockZoteroPdf(detail.key)) return null;
	const entry = read().entries[detail.key]!;
	return { every: every(), tags: MOCK_PUBLISH_TAGS, takenDown: entry.decided === "takenDown" };
}

/** A pending change on one of the record's Zotero PDFs that no pending review holds yet. */
export function mockZoteroChangePending(recordKey: string) {
	const store = read();
	if (store.reviews.some((review) => review.itemKey === recordKey && review.state === "pending")) return false;
	return Object.values(store.entries).some((entry) => entry.parentKey === recordKey && entry.change);
}

export function setMockZoteroChange(key: string, change: Change | null) {
	const store = read();
	const entry = store.entries[key];
	if (!entry) return false;
	entry.change = change;
	write(store);
	return true;
}

const meta = new Map<string, Promise<{ sizeBytes: number; sha256: string }>>();
function fileMeta(key: string) {
	if (!meta.has(key))
		meta.set(key, fetch(`/api/admin/mock-zotero-file/${key}?meta=1`).then((response) => response.json()));
	return meta.get(key)!;
}
const fileUrl = (key: string) => `/api/admin/mock-zotero-file/${key}`;

async function fileState(record: AdminItemDetail, payload: Record<string, unknown>, entry: Entry): Promise<AdminItemDetail> {
	const live = entry.decided === "published" || (entry.decided !== "takenDown" && publishedByRule(record.tags));
	const filename = typeof payload.filename === "string" ? payload.filename : record.title;
	const file = await fileMeta(record.key);
	const now = new Date().toISOString();
	const staged = entry.change === "publish" && !live;
	return {
		...record,
		fileState: staged ? "staged" : live ? "published" : "none",
		filePublication: live
			? { coverPublicUrl: "", filename, itemKey: record.key, pageCount: 0, publicUrl: fileUrl(record.key), publishedAt: now, sha256: file.sha256, sizeBytes: file.sizeBytes, uploadRevision: 1 }
			: null,
		fileDraft: staged
			? { actualSha256: file.sha256, actualSizeBytes: file.sizeBytes, coverHeight: null, coverWidth: null, expectedSha256: file.sha256, expectedSizeBytes: file.sizeBytes, filename, itemKey: record.key, pageCount: null, readyAt: now, updatedAt: now, uploadRevision: 1 }
			: null,
		fileRemovalPending: entry.change === "takeDown" && live,
		sourceFileUrl: fileUrl(record.key),
	};
}

/** The record as the admin would show it with the library's say over its Zotero PDFs. */
export async function mockZoteroDetail(detail: AdminItemDetail, live: (key: string) => Promise<AdminItemDetail>): Promise<AdminItemDetail> {
	const store = read();
	const remember = (key: string, parentKey: string) => (store.entries[key] ??= { parentKey, change: null, decided: null });
	if (detail.parentItem && isZoteroPdf(detail, detail.published)) {
		const entry = remember(detail.key, detail.parentItem);
		write(store);
		return fileState(detail, detail.published ?? {}, entry);
	}
	// A record's attachment rows carry no tags or file type, so each Zotero attachment is read whole.
	const attachments: AdminAttachment[] = await Promise.all(
		detail.attachments.map(async (attachment) => {
			if (attachment.itemType !== "Attachment" || !attachment.sourceConnectionKey.startsWith("zotero-")) return attachment;
			const child = await live(attachment.key);
			if (!isZoteroPdf(child, child.published)) return attachment;
			const { fileState: state, filePublication, fileDraft, fileRemovalPending, sourceFileUrl } = await fileState(child, child.published ?? {}, remember(attachment.key, detail.key));
			return { ...attachment, fileState: state, filePublication, fileDraft, fileRemovalPending, sourceFileUrl };
		}),
	);
	write(store);
	return { ...detail, attachments, fileState: attachments.some((attachment) => attachment.fileState === "staged") ? "staged" : attachments.some((attachment) => attachment.fileState === "published") ? "published" : detail.fileState };
}

function savedReview(review: Review): SavedReview {
	return {
		id: review.id, itemKey: review.itemKey, state: review.state, submittedBy: "mock-owner", submittedAt: review.submittedAt,
		snapshot: { records: [], publishingChoice: null } as unknown as SavedReview["snapshot"], corrections: [], remainingConflicts: {},
		revision: review.revision, resolvedBy: review.resolvedAt ? "mock-owner" : null, resolvedAt: review.resolvedAt, note: review.note,
	};
}

export function mockSubmitReview(recordKey: string, title: string) {
	if (!mockZoteroChangePending(recordKey)) return null;
	const store = read();
	const changes = Object.entries(store.entries).flatMap(([itemKey, entry]) => (entry.parentKey === recordKey && entry.change ? [{ itemKey, change: entry.change }] : []));
	const review: Review = { id: `mock-${crypto.randomUUID()}`, itemKey: recordKey, title, state: "pending", revision: 1, submittedAt: new Date().toISOString(), resolvedAt: null, note: null, changes };
	store.reviews.unshift(review);
	write(store);
	return savedReview(review);
}

export function mockReviewsFor(recordKey: string) {
	return read().reviews.filter((review) => review.itemKey === recordKey).map(savedReview);
}

// A submitted record holds the same payload publishing builds from the published record.
const draftOf = (detail: AdminItemDetail, at: string): AdminItemDraft => ({
	baseRevision: detail.revision, createdAt: at, draftRevision: 1, generation: "mock", itemKey: detail.key, patch: {}, sourceConnectionKey: detail.sourceConnectionKey, updatedAt: at,
	payload: publishedAdminItemPayload(detail.published as Parameters<typeof publishedAdminItemPayload>[0], {
		collectionKeys: detail.publishedCollectionKeys,
		tags: detail.publishedTags,
	}),
});

/** The submitted version: the record as it was, and the Zotero PDFs the review changes, frozen as the review holds them. */
export async function mockReviewSnapshot(id: string, live: (key: string) => Promise<AdminItemDetail>) {
	const review = read().reviews.find((entry) => entry.id === id);
	if (!review) return null;
	const root = await live(review.itemKey);
	const frozenAttachments = await Promise.all(
		review.changes.map(async ({ itemKey, change }) => {
			const attachment = await live(itemKey);
			const file = await fileMeta(itemKey);
			const payload = attachment.published ?? {};
			const filename = typeof payload.filename === "string" ? payload.filename : attachment.title;
			return {
				...attachment, parentItem: root.key, editable: false, draft: draftOf(attachment, review.submittedAt), filePublication: null,
				fileState: change === "publish" ? ("staged" as const) : ("none" as const),
				fileDraft: change === "publish"
					? { actualSha256: file.sha256, actualSizeBytes: file.sizeBytes, coverHeight: null, coverWidth: null, expectedSha256: file.sha256, expectedSizeBytes: file.sizeBytes, filename, itemKey, pageCount: null, readyAt: review.submittedAt, updatedAt: review.submittedAt, uploadRevision: 1 }
					: null,
				fileRemovalPending: change === "takeDown", sourceFileUrl: fileUrl(itemKey),
			};
		}),
	);
	return {
		...root, editable: false, draft: draftOf(root, review.submittedAt),
		attachments: frozenAttachments, fileState: frozenAttachments.some((attachment) => attachment.fileDraft) ? ("staged" as const) : root.fileState,
		frozenAttachments, reviewId: review.id, reviewRevision: review.revision, reviewState: review.state, submittedAt: review.submittedAt,
		submittedBy: "mock-owner", remainingConflicts: {}, note: review.note, publishing: null,
	};
}

function resolve(id: string, state: Review["state"], note?: string) {
	const store = read();
	const review = store.reviews.find((entry) => entry.id === id);
	if (!review) return null;
	review.state = state;
	review.revision += 1;
	review.resolvedAt = new Date().toISOString();
	review.note = note?.trim() || null;
	if (state === "published")
		for (const { itemKey, change } of review.changes) {
			const entry = store.entries[itemKey]!;
			entry.decided = change === "publish" ? "published" : "takenDown";
			entry.change = null;
		}
	write(store);
	return savedReview(review);
}

export function mockApproveReview(id: string) {
	const review = resolve(id, "published");
	return review ? { review, indexingReceipts: [] as AdminSearchIndexReceipt[] } : null;
}

export function mockUpdateReview(id: string, state: "returned" | "withdrawn", note?: string) {
	return resolve(id, state, note);
}

export function mockPendingReviewCount() {
	return read().reviews.filter((review) => review.state === "pending").length;
}

/** The review queue's rows for records with a pending mock review, as the list shows them. */
export async function mockReviewQueueRows(row: (key: string, title: string) => Promise<AdminItemListRow | undefined>) {
	const pending = read().reviews.filter((review) => review.state === "pending");
	return (await Promise.all(pending.map((review) => row(review.itemKey, review.title)))).filter((entry): entry is AdminItemListRow => Boolean(entry));
}
