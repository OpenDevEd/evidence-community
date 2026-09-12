import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { publicationIdentifier, publicationSyncState } from "@/db/schema/publication";
import type { BibliographicDoiInput } from "./bibliographic-doi";
import { buildPublicationIdentifierSummary, resolvePublicDoi } from "./publication-identifier-summary";
import type { PublicationIdentifierSummary } from "./publication-display-adapter";

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
