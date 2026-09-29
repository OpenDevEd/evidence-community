import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import {
	itemFilePublication,
	itemSourceLink,
	sourceConnection,
	sourceFileCleanup,
} from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import type { EvidenceFileStorage } from "@/lib/admin/file-storage";
import type { SourceItemUpsert } from "./batch-schema";
import { isOpenAlexWorkProvider, OPENALEX_WORK_PROVIDERS } from "@/lib/source-providers";

export const MAX_SOURCE_FULL_TEXT_BYTES = 1_500_000;
const CLEANUP_BATCH_SIZE = 100;
const CLEANUP_MAX_ATTEMPTS = 5;

class SourceFileCleanupError extends Error {
	constructor(sourceConnectionKey: string, cause: unknown) {
		super(`Could not clean stale files for source ${sourceConnectionKey}`, {
			cause,
		});
		this.name = "SourceFileCleanupError";
	}
}

export function truncateUtf8(text: string, maxBytes: number) {
	const bytes = Buffer.from(text, "utf8");
	if (bytes.byteLength <= maxBytes) return text;
	const decoder = new TextDecoder("utf-8", { fatal: true });
	for (let end = maxBytes; end >= Math.max(0, maxBytes - 3); end -= 1) {
		try {
			return decoder.decode(bytes.subarray(0, end));
		} catch {
			// A UTF-8 code point may straddle the byte limit.
		}
	}
	throw new Error("Could not truncate UTF-8 text at a valid boundary");
}

export async function readSourceFilePublication(
	database: Database,
	sourceConnectionKey: string,
	sourceRecordKey: string,
	sharedOpenAlex = false,
) {
	const [row] = await database
		.select({
			itemKey: itemSourceLink.itemKey,
			publicationSourceConnectionKey:
				itemFilePublication.sourceConnectionKey,
			remoteVersion: itemSourceLink.remoteVersion,
			contentType: item.contentType,
			coverHeight: item.PDFCoverPageHeight,
			coverObjectPath: itemFilePublication.coverObjectPath,
			coverUrl: item.PDFCoverPageImage,
			coverWidth: item.PDFCoverPageWidth,
			filename: item.filename,
			fullText: item.fullTextPDF,
			linkMode: item.linkMode,
			md5: item.md5,
			mtime: item.mtime,
			objectPath: itemFilePublication.objectPath,
			pageCount: itemFilePublication.pageCount,
			sha256: itemFilePublication.sha256,
			sizeBytes: itemFilePublication.sizeBytes,
			url: item.url,
		})
		.from(itemSourceLink)
		.innerJoin(
			sourceConnection,
			eq(sourceConnection.key, itemSourceLink.sourceConnectionKey),
		)
		.innerJoin(item, eq(item.key, itemSourceLink.itemKey))
		.leftJoin(
			itemFilePublication,
			and(
				eq(itemFilePublication.itemKey, item.key),
				sharedOpenAlex
					? undefined
					: eq(
							itemFilePublication.sourceConnectionKey,
							sourceConnectionKey,
						),
			),
		)
		.where(
			and(
				sharedOpenAlex
					? and(
							inArray(sourceConnection.provider, OPENALEX_WORK_PROVIDERS),
							eq(
								itemSourceLink.sourceConnectionKey,
								itemFilePublication.sourceConnectionKey,
							),
						)
					: eq(
							itemSourceLink.sourceConnectionKey,
							sourceConnectionKey,
						),
				eq(itemSourceLink.sourceRecordKey, sourceRecordKey),
			),
		)
		.limit(1);
	return row;
}

export function sourceFileFromPublication(
	existing: Awaited<ReturnType<typeof readSourceFilePublication>>,
): SourceItemUpsert["file"] {
	if (
		!existing?.md5 ||
		!existing.filename ||
		!existing.url ||
		!existing.coverUrl ||
		!existing.coverWidth ||
		!existing.coverHeight ||
		existing.fullText === null ||
		!existing.objectPath ||
		!existing.coverObjectPath ||
		!existing.pageCount ||
		!existing.sha256 ||
		!existing.sizeBytes
	)
		return null;
	return {
		url: existing.url,
		contentType: existing.contentType ?? "application/pdf",
		filename: existing.filename,
		linkMode: existing.linkMode,
		md5: existing.md5,
		mtime: existing.mtime,
		charset: null,
		fullText: existing.fullText,
		coverUrl: existing.coverUrl,
		coverWidth: existing.coverWidth,
		coverHeight: existing.coverHeight,
		managedPublication: {
			objectPath: existing.objectPath,
			coverObjectPath: existing.coverObjectPath,
			sizeBytes: existing.sizeBytes,
			sha256: existing.sha256,
			pageCount: existing.pageCount,
			staged: false,
		},
	};
}

export async function uploadSourcePublication(options: {
	database: Database;
	storage: EvidenceFileStorage;
	sourceConnectionKey: string;
	paths: { pdf: string; cover: string };
	bytes: Uint8Array;
	cover: Uint8Array;
}) {
	const { database, storage, sourceConnectionKey, paths, bytes, cover } =
		options;
	const stagedPaths = [paths.pdf, paths.cover].map((objectPath) => ({
		sourceConnectionKey,
		objectPath,
		attempts: 0,
		lastError: null,
		deadLetteredAt: null,
		updatedAt: new Date(),
	}));
	await database
		.insert(sourceFileCleanup)
		.values(stagedPaths)
		.onConflictDoUpdate({
			target: [
				sourceFileCleanup.sourceConnectionKey,
				sourceFileCleanup.objectPath,
			],
			set: {
				attempts: 0,
				lastError: null,
				deadLetteredAt: null,
				updatedAt: new Date(),
			},
		});
	// Both uploads must finish before a caller can clean up a failed publication.
	const results = await Promise.allSettled([
		storage.uploadPublic(paths.pdf, bytes, "application/pdf"),
		storage.uploadPublic(paths.cover, cover, "image/jpeg"),
	]);
	for (const result of results)
		if (result.status === "rejected") throw result.reason;
}

/** Returns the error when the file should be retried. */
async function cleanUpFile(
	transaction: DatabaseTransaction,
	storage: EvidenceFileStorage,
	row: typeof sourceFileCleanup.$inferSelect,
) {
	try {
		const [active] = await transaction
			.select({ itemKey: itemFilePublication.itemKey })
			.from(itemFilePublication)
			.where(
				or(
					eq(itemFilePublication.objectPath, row.objectPath),
					eq(itemFilePublication.coverObjectPath, row.objectPath),
				),
			)
			.limit(1);
		if (!active) await storage.removePublic([row.objectPath]);
		await transaction
			.delete(sourceFileCleanup)
			.where(eq(sourceFileCleanup.id, row.id));
		return null;
	} catch (error) {
		const attempts = row.attempts + 1;
		await transaction
			.update(sourceFileCleanup)
			.set({
				attempts,
				deadLetteredAt:
					attempts >= CLEANUP_MAX_ATTEMPTS ? new Date() : null,
				lastError:
					error instanceof Error ? error.message : String(error),
				updatedAt: new Date(),
			})
			.where(eq(sourceFileCleanup.id, row.id));
		return attempts < CLEANUP_MAX_ATTEMPTS ? error : null;
	}
}

export async function flushSourceFileCleanup(
	database: Database,
	storage: EvidenceFileStorage,
	sourceConnectionKey: string,
) {
	while (true) {
		const result = await database.transaction(async (transaction) => {
			const [connection] = await transaction
				.select({ provider: sourceConnection.provider })
				.from(sourceConnection)
				.where(eq(sourceConnection.key, sourceConnectionKey));
			if (isOpenAlexWorkProvider(connection?.provider)) {
				await transaction.execute(
					sql`select pg_advisory_xact_lock(hashtext('new-el:openalex-records'))`,
				);
			}
			// Takes turns with the source's writes without blocking files being staged.
			await transaction
				.select({ key: sourceConnection.key })
				.from(sourceConnection)
				.where(eq(sourceConnection.key, sourceConnectionKey))
				.for("no key update");
			const rows = await transaction
				.select()
				.from(sourceFileCleanup)
				.where(
					and(
						eq(
							sourceFileCleanup.sourceConnectionKey,
							sourceConnectionKey,
						),
						isNull(sourceFileCleanup.deadLetteredAt),
					),
				)
				.orderBy(sourceFileCleanup.createdAt, sourceFileCleanup.id)
				.limit(CLEANUP_BATCH_SIZE)
				.for("update");
			let retryableError: unknown = null;
			for (const row of rows) {
				const error = await cleanUpFile(transaction, storage, row);
				retryableError ??= error;
			}
			return { processed: rows.length, retryableError };
		});
		if (result.retryableError) {
			throw new SourceFileCleanupError(
				sourceConnectionKey,
				result.retryableError,
			);
		}
		if (result.processed === 0) return;
	}
}
