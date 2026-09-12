import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { publicationIdentifier, publicationSyncState } from "@/db/schema/publication";
import type { BibliographicDoiInput } from "./bibliographic-doi";
import { buildPublicationIdentifierSummary, resolvePublicDoi } from "./publication-identifier-summary";
import type { PublicationIdentifierSummary } from "./publication-display-adapter";
import { item } from "@/db/schema/tables/item";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { publicItemVisibility } from "@/lib/public-item-visibility";
import type { BibliographicDoiAttachment } from "./bibliographic-doi";

/** Read only the published attachment metadata used to identify a DOI. */
export async function readPublicDoiAttachments(database: Pick<Database, "select">, keys: readonly string[], hiddenTags: readonly string[]) {
	const byParent = new Map<string, BibliographicDoiAttachment[]>();
	if (!keys.length) return byParent;
	const rows = await database.select({ parent: item.parentItem, url: item.url, tag: itemToTag.tagName })
		.from(item).innerJoin(itemToTag, eq(itemToTag.itemKey, item.key))
		.where(and(inArray(item.parentItem, [...keys]), publicItemVisibility(database, hiddenTags), eq(sql`lower(trim(${itemToTag.tagName}))`, "_r:doi")));
	for (const row of rows) {
		if (!row.parent) continue;
		const attachments = byParent.get(row.parent) ?? [];
		attachments.push({ url: row.url, tags: [row.tag] });
		byParent.set(row.parent, attachments);
	}
	return byParent;
}

/** Batch-read current provider identifiers for records already checked for public access. */
export async function readPublicIdentifiers(
	database: Pick<Database, "select">,
	records: readonly (BibliographicDoiInput & { key: string })[],
	publication: LibraryServerConfig["services"]["publication"],
) {
	const summaries = new Map<string, PublicationIdentifierSummary>();
	const activeParentKeys = records.map((record) => record.key);
	if (activeParentKeys.length === 0) return summaries;
	const [identifierRows, zenodoStateRows] = await Promise.all([
		database
			.select({
				doi: publicationIdentifier.doi,
				itemKey: publicationIdentifier.itemKey,
				lifecycle: publicationIdentifier.lifecycle,
				ownership: publicationIdentifier.ownership,
				registrar: publicationIdentifier.registrar,
				role: publicationIdentifier.role,
			})
			.from(publicationIdentifier)
			.where(
				and(
					inArray(publicationIdentifier.itemKey, activeParentKeys),
					eq(publicationIdentifier.isCurrent, true),
					or(
						and(
							eq(publicationIdentifier.registrar, "crossref"),
							eq(publicationIdentifier.environment, publication.crossref.environment),
						),
						and(
							eq(publicationIdentifier.registrar, "zenodo"),
							eq(publicationIdentifier.environment, publication.zenodo.environment),
						),
					),
				),
			)
			.orderBy(
				asc(publicationIdentifier.itemKey),
				asc(publicationIdentifier.registrar),
				asc(publicationIdentifier.role),
			),
		database
			.select({
				itemKey: publicationSyncState.itemKey,
				zenodoParentId: publicationSyncState.zenodoParentId,
				zenodoRecordId: publicationSyncState.zenodoRecordId,
			})
			.from(publicationSyncState)
			.where(
				and(
					inArray(publicationSyncState.itemKey, activeParentKeys),
					eq(publicationSyncState.provider, "zenodo"),
					eq(publicationSyncState.environment, publication.zenodo.environment),
				),
			),
	]);
	const identifiersByItem = new Map<
		string,
		Array<(typeof identifierRows)[number]>
	>();
	for (const row of identifierRows) {
		const identifiers = identifiersByItem.get(row.itemKey) ?? [];
		identifiers.push(row);
		identifiersByItem.set(row.itemKey, identifiers);
	}
	const zenodoStateByItem = new Map(
		zenodoStateRows.map((row) => [row.itemKey, row]),
	);

	for (const record of records) {
		const key = record.key;
		const state = zenodoStateByItem.get(key);
		const summary = buildPublicationIdentifierSummary({
			identifiers: identifiersByItem.get(key) ?? [],
			bibliographicDoi: resolvePublicDoi(record),
			zenodoState: state
				? { ...state, environment: publication.zenodo.environment }
				: null,
		});
		if (summary) summaries.set(key, summary);
	}
	return summaries;
}
