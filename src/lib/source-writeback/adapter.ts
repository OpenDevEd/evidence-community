import type {
	SourceProvider,
	sourceConnection,
} from "@opendeved/evidence-library-core";
import type { InferSelectModel } from "drizzle-orm";

import type { SourceCredentialResolver } from "@/lib/source-ingestion/credentials";

export type SourceWritebackConnection = InferSelectModel<
	typeof sourceConnection
>;

type SourceWritebackRequestBase = {
	dirtyFields: readonly string[];
	idempotencyKey: string;
	operation: "upsert" | "delete";
	payload: Readonly<Record<string, unknown>>;
	remoteDeleted: boolean;
	remoteVersion: string | null;
	sourceConnection: SourceWritebackConnection;
	sourceRecordKey: string;
};

export type SourceWritebackRequest =
	| (SourceWritebackRequestBase & {
			collectionKey: string;
			entity: "collection";
	  })
	| (SourceWritebackRequestBase & {
			entity: "item";
			itemKey: string;
	  });

export type SourceWritebackResult = {
	remoteVersion: string | null;
	snapshot?: {
		fingerprint: string;
		mappingProfileVersion?: string | null;
		payload: Record<string, unknown>;
	};
	sourceRecordKey: string;
};

export type SourceWritebackContext = {
	credentialResolver?: SourceCredentialResolver;
	signal: AbortSignal;
};

export type SourceWritebackAdapter = {
	provider: Exclude<SourceProvider, "native">;
	write: (
		request: SourceWritebackRequest,
		context: SourceWritebackContext,
	) => Promise<SourceWritebackResult>;
};

export class SourceWritebackAdapterRegistrationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SourceWritebackAdapterRegistrationError";
	}
}

export class SourceWritebackAdapterNotFoundError extends Error {
	constructor(provider: SourceProvider) {
		super(`No writeback adapter is registered for provider: ${provider}`);
		this.name = "SourceWritebackAdapterNotFoundError";
	}
}

export class SourceWritebackAdapterRegistry {
	readonly #adapters = new Map<
		Exclude<SourceProvider, "native">,
		SourceWritebackAdapter
	>();

	constructor(adapters: readonly SourceWritebackAdapter[] = []) {
		for (const adapter of adapters) this.register(adapter);
	}

	register(adapter: SourceWritebackAdapter) {
		if (this.#adapters.has(adapter.provider)) {
			throw new SourceWritebackAdapterRegistrationError(
				`A writeback adapter is already registered for provider: ${adapter.provider}`,
			);
		}
		this.#adapters.set(adapter.provider, adapter);
		return this;
	}

	get(provider: SourceProvider) {
		if (provider === "native") {
			throw new SourceWritebackAdapterNotFoundError(provider);
		}
		const adapter = this.#adapters.get(provider);
		if (!adapter) throw new SourceWritebackAdapterNotFoundError(provider);
		return adapter;
	}

	has(provider: SourceProvider) {
		return provider !== "native" && this.#adapters.has(provider);
	}
}
