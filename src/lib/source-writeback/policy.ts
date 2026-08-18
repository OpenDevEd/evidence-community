import {
	collectionIdentity,
	collectionSourceLink,
	itemIdentity,
	itemSourceLink,
	sourceConnection,
	type SourceConnectionStatus,
	type SourceProvider,
} from "@opendeved/evidence-library-core";
import { desc, eq } from "drizzle-orm";

import type { Database } from "@/db/database-schema";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;
export type SourceWritebackConfiguration = {
	sources: readonly {
		key: string;
		writebackEnabled: boolean;
	}[];
};

export const WRITEBACK_SUPPORTED_PROVIDERS = [
	"zotero",
] as const satisfies readonly SourceProvider[];

export type SourceWritebackReason =
	| "item-locked"
	| "not-linked"
	| "ok"
	| "source-disabled"
	| "source-paused"
	| "source-removed"
	| "unsupported-provider";

export type SourceWritebackPolicy = {
	effective: boolean;
	itemEnabled: boolean;
	reason: SourceWritebackReason;
	sourceEnabled: boolean;
	sourceKey: string | null;
	sourceLabel: string | null;
	sourceStatus: SourceConnectionStatus | null;
	supported: boolean;
};

type SourceWritebackPolicyLink = {
	externalScopeKey: string | null;
	itemEnabled: boolean;
	provider: SourceProvider;
	sourceKey: string;
	sourceStatus: SourceConnectionStatus;
};

function sourceLabel(
	provider: SourceProvider,
	externalScopeKey: string | null,
	key: string,
) {
	return provider === NATIVE_SOURCE_CONNECTION_KEY
		? "Native"
		: `${provider[0]!.toUpperCase()}${provider.slice(1)} · ${externalScopeKey ?? key}`;
}

export function configuredWritebackSourceKeys(
	config: SourceWritebackConfiguration,
) {
	return new Set(
		config.sources
			.filter(({ writebackEnabled }) => writebackEnabled)
			.map(({ key }) => key),
	);
}

export function isSourceWritebackEnabled(
	config: SourceWritebackConfiguration,
	sourceConnectionKey: string,
) {
	return configuredWritebackSourceKeys(config).has(sourceConnectionKey);
}

export function evaluateSourceWritebackPolicy(
	link: SourceWritebackPolicyLink | null,
	config: SourceWritebackConfiguration,
): SourceWritebackPolicy {
	if (!link) {
		return {
			effective: false,
			itemEnabled: false,
			reason: "not-linked",
			sourceEnabled: false,
			sourceKey: null,
			sourceLabel: null,
			sourceStatus: null,
			supported: false,
		};
	}

	const supported = WRITEBACK_SUPPORTED_PROVIDERS.some(
		(provider) => provider === link.provider,
	);
	const sourceEnabled = isSourceWritebackEnabled(config, link.sourceKey);
	let reason: SourceWritebackReason = "ok";
	if (!supported) reason = "unsupported-provider";
	else if (link.sourceStatus === "removed") reason = "source-removed";
	else if (link.sourceStatus === "paused") reason = "source-paused";
	else if (!sourceEnabled) reason = "source-disabled";
	else if (!link.itemEnabled) reason = "item-locked";

	return {
		effective: reason === "ok",
		itemEnabled: link.itemEnabled,
		reason,
		sourceEnabled,
		sourceKey: link.sourceKey,
		sourceLabel: sourceLabel(
			link.provider,
			link.externalScopeKey,
			link.sourceKey,
		),
		sourceStatus: link.sourceStatus,
		supported,
	};
}

export async function resolveItemWritebackPolicy(
	executor: Executor,
	itemKey: string,
	config: SourceWritebackConfiguration,
): Promise<SourceWritebackPolicy> {
	const [identity] = await executor
		.select({ sourceConnectionKey: itemIdentity.sourceConnectionKey })
		.from(itemIdentity)
		.where(eq(itemIdentity.key, itemKey))
		.limit(1);
	if (!identity) {
		return evaluateSourceWritebackPolicy(null, config);
	}

	const links = await executor
		.select({
			connection: sourceConnection,
			link: itemSourceLink,
		})
		.from(itemSourceLink)
		.innerJoin(
			sourceConnection,
			eq(sourceConnection.key, itemSourceLink.sourceConnectionKey),
		)
		.where(eq(itemSourceLink.itemKey, itemKey))
		.orderBy(
			desc(itemSourceLink.writebackEnabled),
			desc(itemSourceLink.updatedAt),
		);
	const selected =
		links.find(({ link }) => link.writebackEnabled) ??
		links.find(
			({ link }) =>
				link.sourceConnectionKey === identity.sourceConnectionKey,
		) ??
		links[0];
	if (!selected) {
		return evaluateSourceWritebackPolicy(null, config);
	}

	const { connection, link } = selected;
	return evaluateSourceWritebackPolicy(
		{
			externalScopeKey: connection.externalScopeKey,
			itemEnabled: link.writebackEnabled,
			provider: connection.provider,
			sourceKey: connection.key,
			sourceStatus: connection.status,
		},
		config,
	);
}

export async function resolveCollectionWritebackPolicy(
	executor: Executor,
	collectionKey: string,
	config: SourceWritebackConfiguration,
): Promise<SourceWritebackPolicy> {
	const [identity] = await executor
		.select({ sourceConnectionKey: collectionIdentity.sourceConnectionKey })
		.from(collectionIdentity)
		.where(eq(collectionIdentity.key, collectionKey))
		.limit(1);
	if (!identity) return evaluateSourceWritebackPolicy(null, config);

	const links = await executor
		.select({
			connection: sourceConnection,
			link: collectionSourceLink,
		})
		.from(collectionSourceLink)
		.innerJoin(
			sourceConnection,
			eq(sourceConnection.key, collectionSourceLink.sourceConnectionKey),
		)
		.where(eq(collectionSourceLink.collectionKey, collectionKey))
		.orderBy(
			desc(collectionSourceLink.writebackEnabled),
			desc(collectionSourceLink.updatedAt),
		);
	const selected =
		links.find(({ link }) => link.writebackEnabled) ??
		links.find(
			({ link }) =>
				link.sourceConnectionKey === identity.sourceConnectionKey,
		) ??
		links[0];
	if (!selected) return evaluateSourceWritebackPolicy(null, config);

	const { connection, link } = selected;
	return evaluateSourceWritebackPolicy(
		{
			externalScopeKey: connection.externalScopeKey,
			itemEnabled: link.writebackEnabled,
			provider: connection.provider,
			sourceKey: connection.key,
			sourceStatus: connection.status,
		},
		config,
	);
}
