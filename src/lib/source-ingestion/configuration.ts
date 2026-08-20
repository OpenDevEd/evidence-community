import { sourceConnection } from "@opendeved/evidence-library-core";
import { eq, ne, sql } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type {
	Database,
	DatabaseTransaction,
} from "@/db/database-schema";

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
		scopeKind: "group" as const,
		externalScopeKey: source.groupId,
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
			.map((row) => [
				`${row.provider}:${row.externalScopeKey}`,
				row,
			] as const),
	);

	for (const source of sources) {
		const existing = currentByKey.get(source.key);
		if (
			existing &&
			(existing.provider !== source.provider ||
				existing.scopeKind !== "group" ||
				existing.externalScopeKey !== source.groupId)
		) {
			throw new SourceConfigurationConflictError(
				`Source ${source.key} already points to a different library.`,
			);
		}
		const scoped = currentByScope.get(`${source.provider}:${source.groupId}`);
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
			continue;
		}
		await transaction.insert(sourceConnection).values(values);
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
