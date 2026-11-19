import "server-only";

import { alias } from "drizzle-orm/pg-core";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { filesHiddenFor } from "@/lib/attachment-visibility";
import { utcDay } from "@/lib/licences";
import type { Database } from "@/db";
import { item } from "@/db/schema/tables/item";
import { itemFilePublication } from "@/db/schema/source";
import { EvidenceFileStorageError, type EvidenceFileStorage } from "./file-storage";
import { hiddenPath } from "./withdrawn-path";

/**
 * A removed record's published PDFs and covers leave the public bucket, where an address someone kept would still open
 * them, for a private place of their own; restoring the record puts the very same bytes back at the same address, so a
 * DOI deposit that lists them still matches (OpenDevEd/new-el#893). The rows stay as they are.
 */


const contentType = (path: string) =>
	/\.pdf$/iu.test(path) ? "application/pdf" : /\.png$/iu.test(path) ? "image/png" : /\.webp$/iu.test(path) ? "image/webp" : "image/jpeg";

async function publicPathsOf(db: Database | Transaction, where: ReturnType<typeof and>) {
	const rows = await db
		.select({ objectPath: itemFilePublication.objectPath, coverObjectPath: itemFilePublication.coverObjectPath })
		.from(itemFilePublication)
		.innerJoin(item, eq(item.key, itemFilePublication.itemKey))
		.where(where);
	return rows.flatMap((row) => [row.objectPath, row.coverObjectPath].filter((path): path is string => Boolean(path)));
}

/**
 * Moves the public files of a removed record's attachments, the ones removed with it, out of public view. Safe to run
 * again: a file already moved is skipped, so pressing Unpublish again on the removed record finishes a move that failed.
 */
export async function hideRemovedFiles(db: Database, storage: EvidenceFileStorage, parentKey: string) {
	await withRecordFiles(db, parentKey, async (transaction) => {
		for (const path of await publicPathsOf(transaction, and(eq(itemFilePublication.parentItemKey, parentKey), eq(item.deleted, 1)))) {
			// The record has left either way; this file stays public until the move runs again, and the log says which.
			await moveFile(storage, path, true).catch((error: unknown) => logUnmoved("removed-record-file-not-hidden", parentKey, path, error));
		}
	});
}

/**
 * Puts each published file of these records (or of the records these attachments belong to) where who may get them
 * says: out of public view while readers can't have them, private or under an embargo not yet over, and in it
 * otherwise, which brings back the files of a record restored after its removal. A file already where it belongs is
 * left alone, so it is safe to run on every publish and every night, which finishes a move that failed. A removed
 * record's files are `hideRemovedFiles`'s.
 */
export async function placeRecordFiles(db: Database, storage: EvidenceFileStorage, keys: readonly string[], today = utcDay()) {
	if (!keys.length) return;
	const parents = await db
		.selectDistinct({ key: itemFilePublication.parentItemKey })
		.from(itemFilePublication)
		.where(or(inArray(itemFilePublication.parentItemKey, [...keys]), inArray(itemFilePublication.itemKey, [...keys])));
	for (const { key: parentKey } of parents) {
		await withRecordFiles(db, parentKey, async (transaction) => {
			const parent = alias(item, "parent");
			const rows = await transaction
				.select({ objectPath: itemFilePublication.objectPath, coverObjectPath: itemFilePublication.coverObjectPath, licence: parent.licence, fileAccess: parent.fileAccess })
				.from(itemFilePublication)
				.innerJoin(item, eq(item.key, itemFilePublication.itemKey))
				.innerJoin(parent, eq(parent.key, itemFilePublication.parentItemKey))
				.where(and(eq(itemFilePublication.parentItemKey, parentKey), eq(item.deleted, 0), eq(parent.deleted, 0)));
			for (const row of rows) {
				const hide = filesHiddenFor(row, today);
				for (const path of [row.objectPath, row.coverObjectPath].filter((value): value is string => Boolean(value))) {
					await moveFile(storage, path, hide).catch((error: unknown) => logUnmoved(hide ? "private-record-file-not-hidden" : "open-record-file-not-shown", parentKey, path, error));
				}
			}
		});
	}
}

/** Whether the record this attachment belongs to keeps its files from readers (`filesHiddenFor`). */
export async function attachmentFilesHidden(db: Database, attachmentKey: string) {
	const parent = alias(item, "parent");
	const [row] = await db
		.select({ licence: parent.licence, fileAccess: parent.fileAccess })
		.from(item)
		.innerJoin(parent, eq(parent.key, item.parentItem))
		.where(eq(item.key, attachmentKey));
	return filesHiddenFor(row);
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Runs one move of a record's files at a time, reading what it moves once it holds the lock: two at once, one hiding
 * and one showing, could each delete the copy the other had just made.
 */
async function withRecordFiles(db: Database, parentKey: string, move: (transaction: Transaction) => Promise<void>) {
	await db.transaction(async (transaction) => {
		await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`record-files:${parentKey}`}, 0))`);
		await move(transaction);
	});
}

/** Moves one published file out of public view (`hide`) or back into it; one already where it belongs is left alone. */
async function moveFile(storage: EvidenceFileStorage, path: string, hide: boolean) {
	// Only a file that isn't there means there is nothing to move; storage failing to answer is a failure, retried later.
	const bytes = await (hide ? storage.downloadPublic(path) : storage.downloadPrivate(hiddenPath(path))).catch((error: unknown) => {
		if (error instanceof EvidenceFileStorageError && error.missing) return null;
		throw error;
	});
	if (!bytes) return;
	if (hide) {
		await storage.uploadPrivate(hiddenPath(path), bytes, contentType(path));
		await storage.removePublic([path]);
		return;
	}
	await storage.uploadPublic(path, bytes, contentType(path));
	await storage.removePrivate([hiddenPath(path)]);
}

function logUnmoved(event: string, parentKey: string, path: string, error: unknown) {
	console.error(JSON.stringify({ event, parentKey, path, error: error instanceof Error ? error.message : String(error) }));
}
