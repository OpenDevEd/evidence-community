import { and, eq, inArray, or } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { itemLink } from "@/db/schema/tables/itemLink";
import { itemSourceLink } from "@/db/schema/source";
import { formatZoteroItemUri } from "@/lib/source-ingestion/zotero/uri";
import { isManualItemLinkOrigin } from "@/lib/links/item-links";

type Executor = Database | DatabaseTransaction;

export type RelatedLinkRow = {
	fromKey: string;
	kind: string;
	origin: string;
	toKey: string;
};

export type RelatedLinkConnection = {
	externalScopeKey: string | null;
	scopeKind: string;
};

/**
 * Which "related" rows a Zotero writeback of `itemKey` should carry as `dc:relation`:
 * every outgoing related row (manual and source) plus incoming rows the editor made.
 * Incoming source rows are Zotero's own mirror of the other item and are left out.
 * Only targets linked to this source (`remoteKeys`) become URIs.
 */
export function relatedLinkUris({
	connection,
	itemKey,
	remoteKeys,
	rows,
}: {
	connection: RelatedLinkConnection;
	itemKey: string;
	remoteKeys: ReadonlyMap<string, string>;
	rows: readonly RelatedLinkRow[];
}): string[] {
	if (!connection.externalScopeKey) return [];
	const libraryType = connection.scopeKind === "group" ? "group" : "user";
	const targets: string[] = [];
	for (const row of rows) {
		if (row.kind !== "related") continue;
		if (row.fromKey === itemKey) {
			targets.push(row.toKey);
		} else if (row.toKey === itemKey && isManualItemLinkOrigin(row.origin)) {
			targets.push(row.fromKey);
		}
	}
	const uris: string[] = [];
	for (const target of [...new Set(targets)]) {
		const remoteKey = remoteKeys.get(target);
		if (!remoteKey) continue;
		uris.push(
			formatZoteroItemUri({
				itemKey: remoteKey,
				libraryId: connection.externalScopeKey,
				libraryType,
			}),
		);
	}
	return uris;
}

/** The record's `relations` JSON with `dc:relation` replaced by the link table's answer. */
export function relationsForWriteback(
	relations: Record<string, unknown> | null | undefined,
	uris: readonly string[],
): Record<string, unknown> {
	const next: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(relations ?? {})) {
		if (key === "dc:relation") continue;
		next[key] = value;
	}
	if (uris.length === 1) next["dc:relation"] = uris[0];
	else if (uris.length > 1) next["dc:relation"] = [...uris];
	return next;
}

/** Loads the rows and remote keys for `itemKey` on one source and returns the URIs. */
export async function relatedRemoteUris(
	db: Executor,
	{
		connection,
		itemKey,
		sourceConnectionKey,
	}: {
		connection: RelatedLinkConnection;
		itemKey: string;
		sourceConnectionKey: string;
	},
): Promise<string[]> {
	const rows = await db
		.select({
			fromKey: itemLink.fromKey,
			kind: itemLink.kind,
			origin: itemLink.origin,
			toKey: itemLink.toKey,
		})
		.from(itemLink)
		.where(
			and(
				eq(itemLink.kind, "related"),
				or(eq(itemLink.fromKey, itemKey), eq(itemLink.toKey, itemKey)),
			),
		);
	const targetKeys = [
		...new Set(
			rows.map((row) => (row.fromKey === itemKey ? row.toKey : row.fromKey)),
		),
	];
	const remoteKeys = new Map<string, string>();
	if (targetKeys.length > 0) {
		const links = await db
			.select({
				itemKey: itemSourceLink.itemKey,
				sourceRecordKey: itemSourceLink.sourceRecordKey,
			})
			.from(itemSourceLink)
			.where(
				and(
					eq(itemSourceLink.sourceConnectionKey, sourceConnectionKey),
					eq(itemSourceLink.remoteDeleted, false),
					inArray(itemSourceLink.itemKey, targetKeys),
				),
			);
		for (const link of links) remoteKeys.set(link.itemKey, link.sourceRecordKey);
	}
	return relatedLinkUris({ connection, itemKey, remoteKeys, rows });
}
