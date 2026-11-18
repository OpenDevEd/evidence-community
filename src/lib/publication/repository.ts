import { and, asc, desc, eq, inArray, or, isNotNull } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "@/db/database-schema";
import {
	doiNamespace,
	publicationIdentifier,
	publicationSyncJob,
	publicationSyncState,
	publicationTarget,
	zenodoFileCorrectionApproval,
	zenodoPublishJournal,
} from "@/db/schema/publication";
import { itemFilePublication } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import { itemToTag } from "@/db/schema/tables/itemToTag";

type Executor = Database | DatabaseTransaction;

export type PublicationRepositorySnapshot = {
	record: typeof item.$inferSelect | null;
	tags: readonly string[];
	attachments: readonly {
		key: string;
		url: string | null;
		tags: readonly string[];
	}[];
	files: readonly (typeof itemFilePublication.$inferSelect)[];
	targets: readonly (typeof publicationTarget.$inferSelect)[];
	identifiers: readonly (typeof publicationIdentifier.$inferSelect)[];
	states: readonly (typeof publicationSyncState.$inferSelect)[];
	jobs: readonly (typeof publicationSyncJob.$inferSelect)[];
	fileCorrectionApprovals: readonly (typeof zenodoFileCorrectionApproval.$inferSelect)[];
	journals: readonly (typeof zenodoPublishJournal.$inferSelect)[];
	namespace: typeof doiNamespace.$inferSelect | null;
};

/** Reads every durable fact needed to build the one admin publication view. */
export async function readPublicationRepositorySnapshot(
	database: Executor,
	itemKey: string,
	crossrefEnvironment: "test" | "production",
): Promise<PublicationRepositorySnapshot> {
	const [
		record,
		tagRows,
		attachmentRows,
		files,
		targets,
		identifiers,
		states,
		jobs,
		fileCorrectionApprovals,
		journals,
		namespace,
	] = await Promise.all([
		database
			.select()
			.from(item)
			.where(eq(item.key, itemKey))
			.limit(1)
			.then((rows) => rows[0] ?? null),
		database
			.select({ name: itemToTag.tagName })
			.from(itemToTag)
			.where(eq(itemToTag.itemKey, itemKey)),
		database
			.select({ key: item.key, url: item.url })
			.from(item)
			// A withdrawn record's attachments are withdrawn with it, and one may hold the DOI its withdrawal is sent under.
			.where(and(eq(item.parentItem, itemKey), or(eq(item.deleted, 0), isNotNull(item.withdrawnAt)))),
		database
			.select()
			.from(itemFilePublication)
			.where(eq(itemFilePublication.parentItemKey, itemKey))
			.orderBy(asc(itemFilePublication.itemKey)),
		database
			.select()
			.from(publicationTarget)
			.where(eq(publicationTarget.itemKey, itemKey)),
		database
			.select()
			.from(publicationIdentifier)
			.where(
				and(
					eq(publicationIdentifier.itemKey, itemKey),
					eq(publicationIdentifier.isCurrent, true),
				),
			)
			.orderBy(
				asc(publicationIdentifier.registrar),
				asc(publicationIdentifier.role),
				asc(publicationIdentifier.id),
			),
		database
			.select()
			.from(publicationSyncState)
			.where(eq(publicationSyncState.itemKey, itemKey)),
		database
			.select()
			.from(publicationSyncJob)
			.where(eq(publicationSyncJob.itemKey, itemKey))
			.orderBy(
				desc(publicationSyncJob.createdAt),
				desc(publicationSyncJob.id),
			),
		database
			.select()
			.from(zenodoFileCorrectionApproval)
			.where(eq(zenodoFileCorrectionApproval.itemKey, itemKey))
			.orderBy(
				desc(zenodoFileCorrectionApproval.approvedAt),
				desc(zenodoFileCorrectionApproval.id),
			),
		database
			.select()
			.from(zenodoPublishJournal)
			.where(
				and(
					eq(zenodoPublishJournal.itemKey, itemKey),
					inArray(zenodoPublishJournal.status, [
						"preparing",
						"ready_to_publish",
					]),
				),
			)
			.orderBy(
				desc(zenodoPublishJournal.createdAt),
				desc(zenodoPublishJournal.id),
			),
		database
			.select()
			.from(doiNamespace)
			.where(eq(doiNamespace.environment, crossrefEnvironment))
			.limit(1)
			.then((rows) => rows[0] ?? null),
	]);

	const attachmentKeys = attachmentRows.map(({ key }) => key);
	const attachmentTagRows =
		attachmentKeys.length === 0
			? []
			: await database
					.select({
						itemKey: itemToTag.itemKey,
						name: itemToTag.tagName,
					})
					.from(itemToTag)
					.where(inArray(itemToTag.itemKey, attachmentKeys));
	const tagsByAttachment = new Map<string, string[]>();
	for (const tag of attachmentTagRows) {
		const tags = tagsByAttachment.get(tag.itemKey);
		if (tags) tags.push(tag.name);
		else tagsByAttachment.set(tag.itemKey, [tag.name]);
	}

	return {
		record,
		tags: tagRows.map(({ name }) => name),
		attachments: attachmentRows.map((attachment) => ({
			...attachment,
			tags: tagsByAttachment.get(attachment.key) ?? [],
		})),
		files,
		targets,
		identifiers,
		states,
		jobs,
		fileCorrectionApprovals,
		journals,
		namespace,
	};
}
