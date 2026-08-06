import { sourceConnection } from "@opendeved/evidence-library-core";
import { eq, type InferSelectModel } from "drizzle-orm";

import type { Database } from "@/db/database-schema";

import type { SourceCredentialResolver } from "../credentials";
import { SourceCredentialNotFoundError } from "../credentials";
import { ZoteroApiClient, type ZoteroLibraryScope } from "./client";
import {
	zoteroConnectionConfigSchema,
	type ZoteroConnectionConfig,
} from "./schema";

type Fetch = typeof fetch;

export type ZoteroSourceConnection = InferSelectModel<typeof sourceConnection>;

type CreateZoteroConnectionClientOptions = {
	credentialResolver?: SourceCredentialResolver;
	fetch?: Fetch;
	sleep?: (milliseconds: number) => Promise<void>;
};

export type ZoteroConnectionClient = {
	client: ZoteroApiClient;
	config: ZoteroConnectionConfig;
	prefix: string;
	scope: ZoteroLibraryScope;
};

export class ZoteroSourceConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ZoteroSourceConfigurationError";
	}
}

function zoteroScope(connection: ZoteroSourceConnection): ZoteroLibraryScope {
	if (!connection.externalScopeKey) {
		throw new ZoteroSourceConfigurationError(
			`Zotero source connection has no external scope: ${connection.key}`,
		);
	}
	if (
		connection.scopeKind !== "group" &&
		connection.scopeKind !== "personal-library"
	) {
		throw new ZoteroSourceConfigurationError(
			`Unsupported Zotero scope kind: ${connection.scopeKind}`,
		);
	}
	return {
		externalScopeKey: connection.externalScopeKey,
		kind: connection.scopeKind,
	};
}

function sourcePrefix(scope: ZoteroLibraryScope) {
	return scope.kind === "group"
		? `groups/${scope.externalScopeKey}`
		: `users/${scope.externalScopeKey}`;
}

export function assertActiveZoteroConnection(
	connection: ZoteroSourceConnection,
) {
	if (connection.provider !== "zotero") {
		throw new ZoteroSourceConfigurationError(
			`Source connection is not a Zotero connection: ${connection.key}`,
		);
	}
	if (connection.status !== "active") {
		throw new ZoteroSourceConfigurationError(
			`Zotero source connection is not active: ${connection.key}`,
		);
	}
	zoteroScope(connection);
	return connection;
}

export async function loadZoteroSourceConnection(
	database: Database,
	key: string,
) {
	const [connection] = await database
		.select()
		.from(sourceConnection)
		.where(eq(sourceConnection.key, key))
		.limit(1);
	if (!connection) {
		throw new ZoteroSourceConfigurationError(
			`Zotero source connection was not found: ${key}`,
		);
	}
	return assertActiveZoteroConnection(connection);
}

export async function createZoteroConnectionClient(
	connection: ZoteroSourceConnection,
	options: CreateZoteroConnectionClientOptions = {},
): Promise<ZoteroConnectionClient> {
	assertActiveZoteroConnection(connection);
	const config = zoteroConnectionConfigSchema.parse(connection.config);
	const scope = zoteroScope(connection);
	let apiKey: string | null = null;
	if (connection.credentialRef) {
		if (!options.credentialResolver) {
			throw new SourceCredentialNotFoundError(connection.credentialRef);
		}
		apiKey = await options.credentialResolver(connection.credentialRef);
		if (!apiKey) {
			throw new SourceCredentialNotFoundError(connection.credentialRef);
		}
	}
	return {
		client: new ZoteroApiClient({
			apiBaseUrl: config.apiBaseUrl,
			apiKey,
			attachmentDownloadTimeoutMs: config.attachmentDownloadTimeoutMs,
			fetch: options.fetch,
			requestTimeoutMs: config.requestTimeoutMs,
			sleep: options.sleep,
		}),
		config,
		prefix: sourcePrefix(scope),
		scope,
	};
}
