import type {
	SourceProvider,
	sourceConnection,
} from "@opendeved/evidence-library-core";
import type { InferSelectModel } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/db/database-schema";

import {
	jsonObjectSchema,
	type JsonValue,
} from "./batch-schema";
import type { SourceCredentialResolver } from "./credentials";

export const SYNCABLE_SOURCE_PROVIDERS = [
	"zotero",
	"mendeley",
	"openalex",
	"dspace",
	"eprints",
] as const satisfies readonly SourceProvider[];

export type SyncableSourceProvider =
	(typeof SYNCABLE_SOURCE_PROVIDERS)[number];
export type SourceConnection = InferSelectModel<typeof sourceConnection>;
export type SourceSyncResult = Record<string, JsonValue>;

export const sourceSyncResultSchema = jsonObjectSchema.superRefine(
	(result, context) => {
		const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
		if (bytes > 1024 * 1024) {
			context.addIssue({
				code: "custom",
				message: "Source sync result exceeds 1 MiB",
			});
		}
	},
);

/** The run an adapter works for: its id tags the search work it queues. */
export type SourceRunProgress = {
	id: number;
	/** Records written so far, and how many there are when the source said. */
	report: (done: number, total: number | null) => Promise<void>;
};

export type SourceAdapterContext = {
	credentialResolver?: SourceCredentialResolver;
	database: Database;
	heartbeat: () => Promise<void>;
	/** Missing when a caller syncs a source outside the orchestrator. */
	run?: SourceRunProgress;
	sourceConnection: SourceConnection;
};

export type SourceAdapter = {
	provider: SyncableSourceProvider;
	/**
	 * When set, the regular sweep runs the source only while this says it is
	 * due. A run someone asks for always goes ahead.
	 */
	isDue?: (connection: SourceConnection, now: Date) => boolean;
	sync: (
		context: SourceAdapterContext,
	) => Promise<SourceSyncResult>;
};

export class SourceAdapterRegistrationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SourceAdapterRegistrationError";
	}
}

export class SourceAdapterNotFoundError extends Error {
	constructor(provider: SyncableSourceProvider) {
		super(`No source adapter is registered for provider: ${provider}`);
		this.name = "SourceAdapterNotFoundError";
	}
}

export class SourceAdapterRegistry {
	readonly #adapters = new Map<
		SyncableSourceProvider,
		SourceAdapter
	>();

	constructor(adapters: readonly SourceAdapter[] = []) {
		for (const adapter of adapters) this.register(adapter);
	}

	register(adapter: SourceAdapter) {
		if (this.#adapters.has(adapter.provider)) {
			throw new SourceAdapterRegistrationError(
				`A source adapter is already registered for provider: ${adapter.provider}`,
			);
		}
		this.#adapters.set(adapter.provider, adapter);
		return this;
	}

	get(provider: SyncableSourceProvider) {
		const adapter = this.#adapters.get(provider);
		if (!adapter) throw new SourceAdapterNotFoundError(provider);
		return adapter;
	}

	has(provider: SyncableSourceProvider) {
		return this.#adapters.has(provider);
	}

	providers() {
		return [...this.#adapters.keys()].sort();
	}
}

export function isSyncableSourceProvider(
	provider: SourceProvider,
): provider is SyncableSourceProvider {
	return (
		SYNCABLE_SOURCE_PROVIDERS as readonly SourceProvider[]
	).includes(provider);
}

export function parseSourceSyncResult(value: unknown) {
	return sourceSyncResultSchema.parse(value);
}

export type SourceSyncResultInput = z.input<
	typeof sourceSyncResultSchema
>;
