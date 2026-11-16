import { readSourceFields } from "./source-fields";
import "server-only";
import { itemIdentity, type itemDraft } from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { itemReview, itemReviewFile, itemReviewSender } from "@/db/schema/review";
import {
	adminItemLinks,
	isAddedPaper,
	openAlexWorkOf,
	draftJson,
	itemSummary,
	payloadLinkKeys,
} from "./library-query-service";
import { ItemNotFoundError } from "./native-item-service";
import { payloadStringList } from "./item-payload";
import type { AdminItemDetail } from "./types";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { readOpenAccessFromSourcesFor } from "@/lib/search-index/open-access";
import { readStudyReading } from "@/lib/readings/reading";
import { addedPaper, itemFilePublication } from "@/db/schema/source";
import { readerAccount, readerUser } from "@/db/schema/tables/reader";
import { OPENSCHOLAR_PROVIDER_ID } from "@/lib/readers/openscholar";
import { projectSourcePdf } from "./source-file-choice";

function snapshotFileDraft(
	file: (typeof itemReviewFile.$inferSelect)["file"] | undefined,
	submittedAt: Date,
) {
	return file
		? {
				actualSha256: file.sha256,
				actualSizeBytes: file.sizeBytes,
				expectedSha256: file.sha256,
				expectedSizeBytes: file.sizeBytes,
				coverHeight: file.coverHeight,
				coverWidth: file.coverWidth,
				filename: file.filename,
				itemKey: file.itemKey,
				pageCount: file.pageCount,
				readyAt: submittedAt.toISOString(),
				updatedAt: submittedAt.toISOString(),
				uploadRevision: file.uploadRevision,
			}
		: null;
}

function snapshotFileState(
	file: (typeof itemReviewFile.$inferSelect)["file"] | undefined,
	review: typeof itemReview.$inferSelect,
	key: string,
	url: unknown,
) {
	return {
		fileState: file ? ("staged" as const) : ("none" as const),
		fileDraft: snapshotFileDraft(file, review.submittedAt),
		sourceFileUrl: file
			? `/api/admin/reviews/${review.id}/files/${key}`
			: typeof url === "string"
				? url
				: null,
	};
}

/**
 * A Zotero PDF change this review holds, shown as the review shows any other file change, as it was submitted
 * whether or not the review is resolved; none for anything else.
 */
function heldSourcePdf(
	itemKey: string,
	review: Pick<typeof itemReview.$inferSelect, "id" | "snapshot" | "submittedAt">,
	held: {
		items: (typeof item.$inferSelect)[];
		config: Pick<LibraryServerConfig, "sources"> | null;
	},
) {
	const change = review.snapshot.sourcePdfChanges?.find((entry) => entry.itemKey === itemKey);
	const published = held.items.find((entry) => entry.key === itemKey) ?? null;
	const projected = held.config && change && published
		? projectSourcePdf(published, {
			itemKey, sourceConnectionKey: published.sourceConnectionKey, sourceRecordKey: published.sourceRecordKey ?? itemKey,
			choice: null, pending: change.change, reviewId: review.id, applied: true, sizeBytes: change.sizeBytes, updatedAt: review.submittedAt,
		}, false, held.config)
		: null;
	if (!projected) return { sourcePdf: null };
	// A take-down shows as the review shows any removal: the PDF it holds goes.
	if (change?.change === "withhold")
		return { sourcePdf: projected.sourcePdf, fileState: "none" as const, fileDraft: null, fileRemovalPending: true, sourceFileUrl: null };
	const { sourcePdf, fileState, fileDraft, fileRemovalPending, sourceFileUrl } = projected;
	return { sourcePdf, fileState, fileDraft, fileRemovalPending, sourceFileUrl };
}

const NO_PAPER = { name: null, email: null, suggested: false };
const NO_ACCOUNT = { name: "", email: null, image: null };

/**
 * Who sent a review. An added paper keeps the name of the person who sent it, who may be outside the team (#777).
 * Their reader account, when they have signed in to the library, gives their photo, their real email and a name the
 * paper lacks; one who never signed in has the email Openscholar sent with the paper. The email goes only to an
 * Editor or Owner, who decides the review.
 */
async function readReviewSender(db: Database, review: { id: string; itemKey: string; submittedBy: string }, withEmail: boolean) {
	const [[own], [paper = NO_PAPER], [account = NO_ACCOUNT]] = await Promise.all([
		db.select({ name: itemReviewSender.name, email: itemReviewSender.email, suggested: itemReviewSender.suggested }).from(itemReviewSender).where(eq(itemReviewSender.reviewId, review.id)),
		db
			.select({ name: addedPaper.addedByName, email: addedPaper.addedByEmail, suggested: addedPaper.suggested })
			.from(addedPaper)
			.where(and(eq(addedPaper.itemKey, review.itemKey), eq(addedPaper.addedBy, review.submittedBy))),
		db
			.select({ name: readerUser.name, email: readerUser.contactEmail, image: readerUser.image })
			.from(readerAccount)
			.innerJoin(readerUser, eq(readerUser.id, readerAccount.userId))
			.where(and(eq(readerAccount.providerId, OPENSCHOLAR_PROVIDER_ID), eq(readerAccount.accountId, review.submittedBy))),
	]);
	// A review keeps who sent its paper; one from before it did, or a record sent from the admin, has the paper's row.
	const sent = own ?? paper;
	return {
		submittedByName: sent.name || account.name || null,
		submittedByImage: account.image,
		submittedByEmail: withEmail ? (account.email ?? sent.email) : null,
		/** Whether they're outside the team. */
		suggested: sent.suggested,
	};
}

export async function getAdminReviewSnapshot(
	db: Database,
	reviewId: string,
	options: {
		topicsEnabled?: boolean;
		config?: Pick<LibraryServerConfig, "sources">;
		/** Only an Editor or Owner, who decides the review, is given the sender's email. */
		senderEmail?: boolean;
	} = {},
) {
	const topicsEnabled =
		options.topicsEnabled ?? (await getLibraryConfig()).topics.enabled;
	const [review] = await db
		.select()
		.from(itemReview)
		.where(eq(itemReview.id, reviewId));
	if (!review) throw new ItemNotFoundError(reviewId);
	const records = review.snapshot.records;
	const [identities, files, publishedRevisions] = await Promise.all([
		db
			.select()
			.from(itemIdentity)
			.where(
				inArray(
					itemIdentity.key,
					records.map((record) => record.itemKey),
				),
			),
		db
			.select()
			.from(itemReviewFile)
			.where(eq(itemReviewFile.reviewId, review.id)),
		db
			.select()
			.from(item)
			.where(
				inArray(
					item.key,
					records.map((record) => record.itemKey),
				),
			),
	]);
	// The sources' rules matter only to a review that holds a Zotero PDF change.
	const sourceConfig = review.snapshot.sourcePdfChanges?.length
		? (options.config ?? (await getLibraryConfig()))
		: null;
	const details = await Promise.all(
		records.map(
			async (
				submitted,
			): Promise<
				AdminItemDetail & {
					draft: NonNullable<AdminItemDetail["draft"]>;
				}
			> => {
				const record =
					review.corrections.find(
						(entry) => entry.itemKey === submitted.itemKey,
					) ?? submitted;
				const identity = identities.find(
					({ key }) => key === record.itemKey,
				);
				if (!identity) throw new ItemNotFoundError(record.itemKey);
				const payload = record.payload;
				const draft: typeof itemDraft.$inferSelect = {
					itemKey: record.itemKey,
					sourceConnectionKey: identity.sourceConnectionKey,
					baseRevision: record.baseRevision,
					generation: review.id,
					draftRevision: review.revision,
					patch: payload,
					createdAt: review.submittedAt,
					updatedAt: review.submittedAt,
				};
				const file = files.find(
					(entry) => entry.itemKey === record.itemKey,
				)?.file;
				const keys = payloadLinkKeys(payload) ?? {
					cites: [],
					related: [],
				};
				const sourceFields = await readSourceFields(db, record.itemKey);
				const detail: AdminItemDetail & { draft: NonNullable<AdminItemDetail["draft"]> } = {
					...itemSummary(null, draft, null, null, payload),
					sourceFields: sourceFields.filter(
						(field) => topicsEnabled || field.field !== "topics",
					),
					importedTopics: [],
					// A submitted version is a snapshot; the working record shows its checks.
					importChecks: null,
					kind: identity.kind,
					importMethod: identity.importMethod,
					revision:
						publishedRevisions.find(
							(published) => published.key === record.itemKey,
						)?.revision ?? 0,
					attachments: [],
					collectionKeys: payloadStringList(payload, "collections"),
					draft: draftJson(draft, payload),
					editable: false,
					...snapshotFileState(
						file,
						review,
						record.itemKey,
						payload.url,
					),
					filePublication: null,
					openalexId: await openAlexWorkOf(db, record.itemKey),
					addedPaper: await isAddedPaper(db, review.itemKey),
					openAccessFromSources: await readOpenAccessFromSourcesFor(db, record.itemKey, payload),
					readingStudyType: await readStudyReading(db, record.itemKey),
					fileRemovalPending: files.some(
						(entry) =>
							entry.itemKey === record.itemKey &&
							entry.file === null,
					),
					links: await adminItemLinks(db, record.itemKey, {
						keys,
						publishedKeys: keys,
					}),
					parentItem:
						typeof payload.parentItem === "string"
							? payload.parentItem
							: null,
					parentState:
						record.itemKey === review.itemKey ? null : "draft",
					published: null,
					publishedCollectionKeys: [],
					publishedTags: [],
					tags: payloadStringList(payload, "tags"),
					writeback: {
						available: [],
						originSourceKey: null,
						selected: [],
					},
					sourcePdfChangePending: false,
					...heldSourcePdf(record.itemKey, review, { items: publishedRevisions, config: sourceConfig }),
				};
				return detail;
			},
		),
	);
	const root = details.find((detail) => detail.key === review.itemKey);
	if (!root) throw new ItemNotFoundError(review.itemKey);
	const sender = await readReviewSender(db, review, options.senderEmail ?? false);
	const frozenAttachments = details.filter(
		(detail) => detail.parentItem === root.key,
	);
	return {
		...root,
		attachments: frozenAttachments.map((detail) => ({
			...detail,
			parentItem: root.key,
		})),
		fileState: frozenAttachments.some((detail) => detail.fileDraft)
			? ("staged" as const)
			: root.fileState,
		frozenAttachments,
		reviewId: review.id,
		reviewRevision: review.revision,
		reviewState: review.state,
		submittedAt: review.submittedAt.toISOString(),
		submittedBy: review.submittedBy,
		...sender,
		remainingConflicts: review.remainingConflicts,
		note: review.note,
		publishing: review.snapshot.publishingChoice,
		/** Records the review only shows, not corrected since: approving doesn't check or publish them. */
		unchangedKeys: records
			.filter((record) => record.unchanged && !review.corrections.some((correction) => correction.itemKey === record.itemKey))
			.map((record) => record.itemKey),
	};
}
