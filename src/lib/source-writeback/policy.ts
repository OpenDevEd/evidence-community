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
import { sourceDisplayLabel } from "@/lib/admin/source-label";

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
	displayName?: string | null;
	externalScopeKey: string | null;
	itemEnabled: boolean;
	provider: SourceProvider;
	sourceKey: string;
	sourceStatus: SourceConnectionStatus;
};

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
		sourceLabel: sourceDisplayLabel({
			displayName: link.displayName,
			externalScopeKey: link.externalScopeKey,
			key: link.sourceKey,
			provider: link.provider,
		}),
		sourceStatus: link.sourceStatus,
		supported,
	};
}

export type WritebackTarget = SourceWritebackPolicy & {
	isOrigin: boolean;
	linkExists: boolean;
	provider: SourceProvider;
	sourceKey: string;
	sourceLabel: string;
};

export type ItemWritebackTargets = {
	available: WritebackTarget[];
	originSourceKey: string | null;
	selected: string[];
};

type WritebackTargetConnection = {
	displayName?: string | null;
	externalScopeKey: string | null;
	key: string;
	provider: SourceProvider;
	status: SourceConnectionStatus;
};

type WritebackTargetLink = {
	sourceConnectionKey: string;
	writebackEnabled: boolean;
};

/**
 * Lists the sources a record may write back to.
 *
 * Configured writeback sources come first, in config order. A source the
 * record already links to is always listed, even when the library turned its
 * writeback off, so the admin can see why nothing is sent. Sources the record
 * does not link to are hidden when they are removed, unsupported, or turned
 * off. Native never appears.
 */
export function buildItemWritebackTargets({
	config,
	connections,
	links,
	originSourceKey,
}: {
	config: SourceWritebackConfiguration;
	connections: readonly WritebackTargetConnection[];
	links: readonly WritebackTargetLink[];
	originSourceKey: string | null;
}): ItemWritebackTargets {
	const linkBySource = new Map(
		links.map((link) => [link.sourceConnectionKey, link] as const),
	);
	const connectionByKey = new Map(
		connections.map((connection) => [connection.key, connection] as const),
	);
	const orderedKeys = [
		...config.sources.map(({ key }) => key),
		...connections.map(({ key }) => key),
	].filter((key, index, keys) => keys.indexOf(key) === index);
	const origin =
		originSourceKey && originSourceKey !== NATIVE_SOURCE_CONNECTION_KEY
			? originSourceKey
			: null;

	const available: WritebackTarget[] = [];
	for (const key of orderedKeys) {
		const connection = connectionByKey.get(key);
		if (!connection || connection.provider === NATIVE_SOURCE_CONNECTION_KEY) {
			continue;
		}
		const link = linkBySource.get(key) ?? null;
		const policy = evaluateSourceWritebackPolicy(
			{
				displayName: connection.displayName,
				externalScopeKey: connection.externalScopeKey,
				itemEnabled: link?.writebackEnabled ?? false,
				provider: connection.provider,
				sourceKey: connection.key,
				sourceStatus: connection.status,
			},
			config,
		);
		const listable =
			link !== null ||
			(policy.supported &&
				policy.sourceEnabled &&
				connection.status !== "removed");
		if (!listable) continue;
		available.push({
			...policy,
			isOrigin: origin === key,
			linkExists: link !== null,
			provider: connection.provider,
			// An unlinked target has no link to be "locked"; every other reason
			// (paused, disabled, removed, unsupported) still applies to it.
			reason:
				link || policy.reason !== "item-locked" ? policy.reason : "not-linked",
			sourceKey: connection.key,
			sourceLabel: sourceDisplayLabel(connection),
		});
	}

	return {
		available,
		originSourceKey: origin,
		selected: available
			.filter((target) => target.linkExists && target.itemEnabled)
			.map((target) => target.sourceKey),
	};
}

export function findWritebackTarget(
	targets: ItemWritebackTargets,
	sourceKey: string,
) {
	return (
		targets.available.find((target) => target.sourceKey === sourceKey) ??
		null
	);
}

/**
 * Why an imported record cannot be edited, or null when it can.
 *
 * Editing stays open while the origin source can receive writeback. The
 * admin may have unchecked the origin for this record (`item-locked`); that
 * is a choice, not a block. Native records never reach this rule.
 */
export function importedItemEditBlockReason(
	targets: ItemWritebackTargets,
): SourceWritebackReason | null {
	if (!targets.originSourceKey) return null;
	const origin = findWritebackTarget(targets, targets.originSourceKey);
	if (origin?.provider === "openalex") return null;
	const reason = origin?.reason ?? "not-linked";
	return reason === "ok" || reason === "item-locked" || reason === "not-linked"
		? null
		: reason;
}

export async function resolveItemWritebackTargets(
	executor: Executor,
	itemKey: string,
	config: SourceWritebackConfiguration,
): Promise<ItemWritebackTargets> {
	const [[identity], connections, links] = await Promise.all([
		executor
			.select({ sourceConnectionKey: itemIdentity.sourceConnectionKey })
			.from(itemIdentity)
			.where(eq(itemIdentity.key, itemKey))
			.limit(1),
		executor
			.select({
				displayName: sourceConnection.displayName,
				externalScopeKey: sourceConnection.externalScopeKey,
				key: sourceConnection.key,
				provider: sourceConnection.provider,
				status: sourceConnection.status,
			})
			.from(sourceConnection),
		executor
			.select({
				sourceConnectionKey: itemSourceLink.sourceConnectionKey,
				writebackEnabled: itemSourceLink.writebackEnabled,
			})
			.from(itemSourceLink)
			.where(eq(itemSourceLink.itemKey, itemKey)),
	]);
	return buildItemWritebackTargets({
		config,
		connections,
		links: identity ? links : [],
		originSourceKey: identity?.sourceConnectionKey ?? null,
	});
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
			displayName: connection.displayName,
			externalScopeKey: connection.externalScopeKey,
			itemEnabled: link.writebackEnabled,
			provider: connection.provider,
			sourceKey: connection.key,
			sourceStatus: connection.status,
		},
		config,
	);
}
