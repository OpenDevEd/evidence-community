import { isDeepStrictEqual } from "node:util";
import { itemSourceLink, openAlexQueryApproval } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import { enqueueItemSearchReprojections } from "@/lib/publication/queue";
import { saveSourceScreening } from "@/lib/readings/screening";
import { isOpenAlexWorkProvider } from "@/lib/source-providers";
import { sourceConnection } from "@opendeved/evidence-library-core";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database, DatabaseTransaction } from "@/db/database-schema";

type ConfiguredSource = LibraryServerConfig["sources"][number];

export class SourceConfigurationConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SourceConfigurationConflictError";
	}
}

/** Where each source lives at its provider. Zotero groups and OpenScholar collections take their name from the provider during sync. */
function sourceScope(source: ConfiguredSource) {
	switch (source.provider) {
		case "zotero":
			return { scopeKind: "group" as const, externalScopeKey: source.groupId };
		case "openscholar":
			return { scopeKind: "collection" as const, externalScopeKey: source.collectionId };
		case "openalex":
			return { scopeKind: "query" as const, externalScopeKey: null, displayName: source.settings.name };
	}
}

export function configuredSourceConnectionValues(source: ConfiguredSource) {
	return {
		key: source.key,
		provider: source.provider,
		...sourceScope(source),
		config: source.settings,
		status: source.enabled ? ("active" as const) : ("paused" as const),
	};
}

type SourceConnectionRow = typeof sourceConnection.$inferSelect;

async function assertOpenAlexApproval(
	transaction: DatabaseTransaction,
	source: ConfiguredSource,
) {
	if (source.provider !== "openalex") return;
	const [previous] = await transaction
		.select()
		.from(openAlexQueryApproval)
		.where(
			and(
				eq(openAlexQueryApproval.sourceConnectionKey, source.key),
				eq(
					openAlexQueryApproval.version,
					source.settings.approvedQuery.version,
				),
			),
		);
	if (
		previous &&
		!isDeepStrictEqual(previous.approval, source.settings.approvedQuery)
	) {
		throw new SourceConfigurationConflictError(
			`Source ${source.key} requires a new query approval version.`,
		);
	}
}

async function assertSourceFits(
	transaction: DatabaseTransaction,
	source: ConfiguredSource,
	currentByKey: Map<string, SourceConnectionRow>,
	currentByScope: Map<string, SourceConnectionRow>,
) {
	const existing = currentByKey.get(source.key);
	const values = configuredSourceConnectionValues(source);
	if (
		existing &&
		(existing.provider !== source.provider ||
			existing.scopeKind !== values.scopeKind ||
			existing.externalScopeKey !== values.externalScopeKey)
	) {
		throw new SourceConfigurationConflictError(
			`Source ${source.key} already points to a different library.`,
		);
	}
	await assertOpenAlexApproval(transaction, source);
	if (!values.externalScopeKey) return;
	const scoped = currentByScope.get(`${source.provider}:${values.externalScopeKey}`);
	if (scoped && scoped.key !== source.key) {
		const scope = source.provider === "zotero" ? "Zotero group" : "OpenScholar collection";
		throw new SourceConfigurationConflictError(
			`${scope} ${values.externalScopeKey} already belongs to source ${scoped.key}.`,
		);
	}
}

async function saveSource(
	transaction: DatabaseTransaction,
	source: ConfiguredSource,
	existing: SourceConnectionRow | undefined,
) {
	const values = configuredSourceConnectionValues(source);
	if (existing) {
		await transaction
			.update(sourceConnection)
			.set({
				...("displayName" in values
					? { displayName: values.displayName }
					: {}),
				config: values.config,
				status: values.status,
				updatedAt: new Date(),
			})
			.where(eq(sourceConnection.key, source.key));
	} else {
		await transaction.insert(sourceConnection).values(values);
	}
	if (source.provider === "openalex") {
		await transaction
			.insert(openAlexQueryApproval)
			.values({
				sourceConnectionKey: source.key,
				version: source.settings.approvedQuery.version,
				approval: source.settings.approvedQuery,
			})
			.onConflictDoNothing();
	}
}

async function reconcileInTransaction(
	transaction: DatabaseTransaction,
	sources: LibraryServerConfig["sources"],
) {
	await transaction.execute(
		sql`select pg_advisory_xact_lock(hashtext('new-el:configured-sources'))`,
	);

	const current = await transaction
		.select()
		.from(sourceConnection)
		.where(ne(sourceConnection.provider, "native"));
	const currentByKey = new Map(current.map((row) => [row.key, row]));
	const currentByScope = new Map(
		current
			.filter((row) => row.externalScopeKey)
			.map(
				(row) =>
					[`${row.provider}:${row.externalScopeKey}`, row] as const,
			),
	);

	for (const source of sources) {
		await assertSourceFits(
			transaction,
			source,
			currentByKey,
			currentByScope,
		);
	}

	const configuredKeys = new Set(sources.map((source) => source.key));
	for (const row of current) {
		if (!configuredKeys.has(row.key)) {
			await transaction
				.update(sourceConnection)
				.set({
					status: "removed",
					updatedAt: new Date(),
				})
				.where(eq(sourceConnection.key, row.key));
		}
	}

	for (const source of sources) {
		await saveSource(transaction, source, currentByKey.get(source.key));
	}

	const saved = await transaction
		.select()
		.from(sourceConnection)
		.where(ne(sourceConnection.provider, "native"));
	await requeueRecordsOfToggledWorkSources(transaction, current, saved);
	await saveSourceScreening(transaction, sources);
	return saved;
}

/**
 * A removed OpenAlex source's copies of its works stop counting for the open-access label, and count again when the
 * source returns, so the records it holds are searched again either way.
 */
async function requeueRecordsOfToggledWorkSources(
	transaction: DatabaseTransaction,
	before: readonly { key: string; status: string }[],
	after: readonly { key: string; provider: string; status: string }[],
) {
	const removedBefore = new Map(before.map((row) => [row.key, row.status === "removed"]));
	const toggled = after
		.filter((row) => isOpenAlexWorkProvider(row.provider) && removedBefore.has(row.key))
		.filter((row) => removedBefore.get(row.key) !== (row.status === "removed"))
		.map((row) => row.key);
	if (toggled.length === 0) return;
	const records = await transaction
		.selectDistinct({ itemKey: item.key, revision: item.revision })
		.from(item)
		.innerJoin(itemSourceLink, eq(itemSourceLink.itemKey, item.key))
		.where(and(inArray(itemSourceLink.sourceConnectionKey, toggled), eq(item.deleted, 0)));
	await enqueueItemSearchReprojections(transaction, records, new Date());
}

export function reconcileConfiguredSources(
	database: Database,
	sources: LibraryServerConfig["sources"],
) {
	return database.transaction((transaction) =>
		reconcileInTransaction(transaction, sources),
	);
}
