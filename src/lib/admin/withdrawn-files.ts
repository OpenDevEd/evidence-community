import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db";
import { item } from "@/db/schema/tables/item";
import { itemFilePublication } from "@/db/schema/source";
import type { EvidenceFileStorage } from "./file-storage";

/**
 * A removed record's published PDFs and covers leave the public bucket, where an address someone kept would still open
 * them, for a private place of their own; restoring the record puts the very same bytes back at the same address, so a
 * DOI deposit that lists them still matches (OpenDevEd/new-el#893). The rows stay as they are.
 */
const hiddenPath = (publicPath: string) => `withdrawn/${publicPath}`;

const contentType = (path: string) =>
	/\.pdf$/iu.test(path) ? "application/pdf" : /\.png$/iu.test(path) ? "image/png" : /\.webp$/iu.test(path) ? "image/webp" : "image/jpeg";

async function publicPathsOf(db: Database, where: ReturnType<typeof and>) {
	const rows = await db
		.select({ objectPath: itemFilePublication.objectPath, coverObjectPath: itemFilePublication.coverObjectPath })
		.from(itemFilePublication)
		.innerJoin(item, eq(item.key, itemFilePublication.itemKey))
		.where(where);
	return rows.flatMap((row) => [row.objectPath, row.coverObjectPath].filter((path): path is string => Boolean(path)));
}

/** Moves the public files of a removed record's attachments, the ones removed with it, out of public view. */
export async function hideRemovedFiles(db: Database, storage: EvidenceFileStorage, parentKey: string) {
	const paths = await publicPathsOf(db, and(eq(itemFilePublication.parentItemKey, parentKey), eq(item.deleted, 1)));
	if (!paths.length) return;
	try {
		for (const path of paths) await storage.uploadPrivate(hiddenPath(path), await storage.downloadPublic(path), contentType(path));
		await storage.removePublic(paths);
	} catch (error) {
		// The record has left either way; its files stay where they were, and the log says which.
		console.error(JSON.stringify({ event: "removed-record-files-not-hidden", parentKey, paths, error: error instanceof Error ? error.message : String(error) }));
	}
}

/** Puts the files of attachments restored with their record back where they were published. */
export async function revealRestoredFiles(db: Database, storage: EvidenceFileStorage, attachmentKeys: readonly string[]) {
	if (!attachmentKeys.length) return;
	const paths = await publicPathsOf(db, and(inArray(itemFilePublication.itemKey, [...attachmentKeys]), eq(item.deleted, 0)));
	for (const path of paths) {
		try {
			await storage.uploadPublic(path, await storage.downloadPrivate(hiddenPath(path)), contentType(path));
			await storage.removePrivate([hiddenPath(path)]);
		} catch (error) {
			console.error(JSON.stringify({ event: "restored-record-file-not-shown", path, error: error instanceof Error ? error.message : String(error) }));
		}
	}
}
