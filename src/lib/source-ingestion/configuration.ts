import { isDeepStrictEqual } from "node:util";
import { openAlexQueryApproval } from "@/db/schema/source";
import { sourceConnection } from "@opendeved/evidence-library-core";
import { and, eq, ne, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database, DatabaseTransaction } from "@/db/database-schema";

type ConfiguredSource = LibraryServerConfig["sources"][number];

export class SourceConfigurationConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SourceConfigurationConflictError";
	}
}

export function configuredSourceConnectionValues(source: ConfiguredSource) {
	return {
		key: source.key,
		provider: source.provider,
		scopeKind:
			source.provider === "zotero"
				? ("group" as const)
				: ("query" as const),
		externalScopeKey: source.provider === "zotero" ? source.groupId : null,
		config: source.settings,
		status: source.enabled ? ("active" as const) : ("paused" as const),
	};
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
		if (source.provider === "openalex") {
			const [previous] = await transaction
				.select()
				.from(openAlexQueryApproval)
				.where(
					and(
						eq(
							openAlexQueryApproval.sourceConnectionKey,
							source.key,
						),
						eq(
							openAlexQueryApproval.version,
							source.settings.approvedQuery.version,
						),
					),
				);
			if (
				previous &&
				!isDeepStrictEqual(
					previous.approval,
					source.settings.approvedQuery,
				)
			) {
				throw new SourceConfigurationConflictError(
					`Source ${source.key} requires a new query approval version.`,
				);
			}
		}
		if (source.provider !== "zotero") continue;
		const scoped = currentByScope.get(
			`${source.provider}:${source.groupId}`,
		);
		if (scoped && scoped.key !== source.key) {
			throw new SourceConfigurationConflictError(
				`Zotero group ${source.groupId} already belongs to source ${scoped.key}.`,
			);
		}
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
		const values = configuredSourceConnectionValues(source);
		const existing = currentByKey.get(source.key);
		if (existing) {
			await transaction
				.update(sourceConnection)
				.set({
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

	return transaction
		.select()
		.from(sourceConnection)
		.where(ne(sourceConnection.provider, "native"));
}

export function reconcileConfiguredSources(
	database: Database,
	sources: LibraryServerConfig["sources"],
) {
	return database.transaction((transaction) =>
		reconcileInTransaction(transaction, sources),
	);
}
