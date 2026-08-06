import { createHash } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { isSourceConnectionKey } from "@opendeved/evidence-library-core";

import type { Database } from "@/db/database-schema";
import {
	itemFilePublication,
	itemIdentity,
	sourceConnection,
	sourceFileCleanup,
} from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import type { EvidenceFileStorage } from "@/lib/admin/file-storage";
import { processPdf } from "@/lib/admin/pdf-processing";

import type {
	ZoteroAttachmentProcessor,
	ZoteroAttachmentProcessorContext,
} from "./mapper";
import { ZoteroAttachmentPermanentError } from "./mapper";
import { ZoteroApiError } from "./client";
import type { ZoteroItemResponse } from "./schema";

export const MAX_ZOTERO_FULL_TEXT_BYTES = 1_500_000;
const CLEANUP_BATCH_SIZE = 100;
const CLEANUP_MAX_ATTEMPTS = 5;
const PDF_CONTENT_TYPE = "application/pdf";
const MD5_PATTERN = /^[0-9a-f]{32}$/u;
const ZOTERO_ITEM_KEY_PATTERN = /^[A-Z0-9]{8}$/u;

type AttachmentProcessorOptions = {
	database: Database;
	maxPdfBytes: number;
	publishTags: readonly string[];
	storage: EvidenceFileStorage;
};

export class ZoteroAttachmentProcessingError extends Error {
	constructor(itemKey: string, message: string, options?: ErrorOptions) {
		super(`Zotero attachment ${itemKey}: ${message}`, options);
		this.name = "ZoteroAttachmentProcessingError";
	}
}

export class SourceFileCleanupError extends Error {
	constructor(sourceConnectionKey: string, cause: unknown) {
		super(`Could not clean stale files for source ${sourceConnectionKey}`, {
			cause,
		});
		this.name = "SourceFileCleanupError";
	}
}

function optionalString(value: unknown, maxLength: number) {
	return typeof value === "string" && value.trim().length > 0
		? value.trim().slice(0, maxLength)
		: null;
}

function tags(item: ZoteroItemResponse) {
	return new Set((item.data.tags ?? []).map(({ tag }) => tag));
}

function isPublished(item: ZoteroItemResponse, publishTags: readonly string[]) {
	const itemTags = tags(item);
	return publishTags.some((tag) => itemTags.has(tag));
}

export function sourcePublicationPaths(
	sourceConnectionKey: string,
	sourceRecordKey: string,
	md5: string,
) {
	if (
		!isSourceConnectionKey(sourceConnectionKey) ||
		!ZOTERO_ITEM_KEY_PATTERN.test(sourceRecordKey) ||
		!MD5_PATTERN.test(md5)
	) {
		throw new Error("Invalid Zotero source publication path identity");
	}
	const root = [
		"sources",
		"zotero",
		sourceConnectionKey,
		sourceRecordKey,
		md5,
	].join("/");
	return {
		cover: `${root}/cover.png`,
		pdf: `${root}/document.pdf`,
	};
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

async function currentPublication(
	database: Database,
	sourceConnectionKey: string,
	sourceRecordKey: string,
) {
	const [row] = await database
		.select({
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
		.from(itemIdentity)
		.innerJoin(item, eq(item.key, itemIdentity.key))
		.leftJoin(
			itemFilePublication,
			eq(itemFilePublication.itemKey, item.key),
		)
		.where(
			and(
				eq(itemIdentity.sourceConnectionKey, sourceConnectionKey),
				eq(itemIdentity.sourceRecordKey, sourceRecordKey),
			),
		)
		.limit(1);
	return row;
}

function baseFile(item: ZoteroItemResponse) {
	return {
		url: null,
		contentType: optionalString(item.data.contentType, 128),
		filename: optionalString(item.data.filename, 255),
		linkMode: optionalString(item.data.linkMode, 128),
		md5: optionalString(item.data.md5, 255),
		mtime:
			item.data.mtime === undefined || item.data.mtime === null
				? null
				: String(item.data.mtime).slice(0, 255),
		charset: optionalString(item.data.charset, 128),
		fullText: null,
		coverUrl: null,
		coverWidth: null,
		coverHeight: null,
		managedPublication: null,
	};
}

export async function flushSourceFileCleanup(
	database: Database,
	storage: EvidenceFileStorage,
	sourceConnectionKey: string,
) {
	while (true) {
		const result = await database.transaction(async (transaction) => {
			await transaction
				.select({ key: sourceConnection.key })
				.from(sourceConnection)
				.where(eq(sourceConnection.key, sourceConnectionKey))
				.for("update");
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
				try {
					await storage.removePublic([row.objectPath]);
					await transaction
						.delete(sourceFileCleanup)
						.where(eq(sourceFileCleanup.id, row.id));
				} catch (error) {
					const attempts = row.attempts + 1;
					await transaction
						.update(sourceFileCleanup)
						.set({
							attempts,
							deadLetteredAt:
								attempts >= CLEANUP_MAX_ATTEMPTS
									? new Date()
									: null,
							lastError:
								error instanceof Error
									? error.message
									: String(error),
							updatedAt: new Date(),
						})
						.where(eq(sourceFileCleanup.id, row.id));
					if (attempts < CLEANUP_MAX_ATTEMPTS) {
						retryableError ??= error;
					}
				}
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

export function createZoteroAttachmentProcessor(
	options: AttachmentProcessorOptions,
): ZoteroAttachmentProcessor {
	const publishTags = [
		...new Set(options.publishTags.map((tag) => tag.trim())),
	].filter(Boolean);
	if (publishTags.length === 0) {
		throw new Error("At least one Zotero PDF publication tag is required");
	}

	const processor = async (
		item: ZoteroItemResponse,
		context?: ZoteroAttachmentProcessorContext,
	) => {
		const base = baseFile(item);
		if (
			item.data.contentType !== PDF_CONTENT_TYPE ||
			!isPublished(item, publishTags)
		) {
			return base;
		}
		if (!context) {
			throw new Error(
				`Zotero attachment ${item.key}: processor context is missing`,
			);
		}
		const linkMode = optionalString(item.data.linkMode, 128);
		if (linkMode !== "imported_file" && linkMode !== "imported_url") {
			throw new ZoteroAttachmentPermanentError(
				"zotero_file_unavailable",
				`Zotero attachment ${item.key}: published PDFs must use imported_file or imported_url storage`,
				base,
			);
		}
		if (!item.data.parentItem) {
			throw new ZoteroAttachmentPermanentError(
				"zotero_parent_required",
				`Zotero attachment ${item.key}: a published PDF must have a parent item`,
				base,
			);
		}
		const rawFilename =
			typeof item.data.filename === "string"
				? item.data.filename.trim()
				: "";
		const filename =
			rawFilename.length > 0 && rawFilename.length <= 255
				? rawFilename
				: null;
		const md5 = optionalString(item.data.md5, 255)?.toLowerCase() ?? null;
		if (!filename || !md5 || !MD5_PATTERN.test(md5)) {
			throw new ZoteroAttachmentPermanentError(
				"zotero_file_metadata_invalid",
				`Zotero attachment ${item.key}: a published PDF must have a valid filename and MD5`,
				base,
			);
		}

		const existing = await currentPublication(
			options.database,
			context.sourceConnectionKey,
			item.key,
		);
		if (
			existing?.md5?.toLowerCase() === md5 &&
			existing.url &&
			existing.coverUrl &&
			existing.coverWidth &&
			existing.coverHeight &&
			existing.fullText !== null &&
			existing.objectPath &&
			existing.coverObjectPath &&
			existing.pageCount &&
			existing.sha256 &&
			existing.sizeBytes
		) {
			return {
				...base,
				url: existing.url,
				contentType: existing.contentType ?? PDF_CONTENT_TYPE,
				filename,
				linkMode: base.linkMode ?? existing.linkMode,
				md5,
				mtime: base.mtime ?? existing.mtime,
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

		let downloaded;
		try {
			downloaded = await context.client.downloadAttachment(
				context.prefix,
				item.key,
				options.maxPdfBytes,
			);
		} catch (error) {
			if (
				error instanceof ZoteroApiError &&
				(error.status === 404 || error.status === 413)
			) {
				throw new ZoteroAttachmentPermanentError(
					error.status === 413
						? "zotero_file_too_large"
						: "zotero_file_unavailable",
					`Zotero attachment ${item.key}: ${error.message}`,
					base,
					{ cause: error },
				);
			}
			throw error;
		}
		const actualMd5 = createHash("md5")
			.update(downloaded.bytes)
			.digest("hex");
		if (actualMd5 !== md5) {
			throw new ZoteroAttachmentProcessingError(
				item.key,
				`downloaded MD5 ${actualMd5} does not match metadata MD5 ${md5}`,
			);
		}

		let processed;
		try {
			processed = await processPdf(downloaded.bytes);
		} catch (error) {
			throw new ZoteroAttachmentPermanentError(
				"zotero_pdf_invalid",
				`Zotero attachment ${item.key}: the published file is not a processable PDF`,
				base,
				{ cause: error },
			);
		}
		const sha256 = createHash("sha256")
			.update(downloaded.bytes)
			.digest("hex");
		const paths = sourcePublicationPaths(
			context.sourceConnectionKey,
			item.key,
			md5,
		);
		const stagedPaths = [paths.pdf, paths.cover].map((objectPath) => ({
			sourceConnectionKey: context.sourceConnectionKey,
			objectPath,
			attempts: 0,
			lastError: null,
			deadLetteredAt: null,
			updatedAt: new Date(),
		}));
		await options.database
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
		await Promise.all([
			options.storage.uploadPublic(
				paths.pdf,
				downloaded.bytes,
				PDF_CONTENT_TYPE,
			),
			options.storage.uploadPublic(
				paths.cover,
				processed.cover,
				"image/png",
			),
		]);

		return {
			...base,
			url: options.storage.publicUrl(paths.pdf),
			contentType: PDF_CONTENT_TYPE,
			filename,
			md5,
			fullText: truncateUtf8(processed.text, MAX_ZOTERO_FULL_TEXT_BYTES),
			coverUrl: options.storage.publicUrl(paths.cover),
			coverWidth: processed.coverWidth,
			coverHeight: processed.coverHeight,
			managedPublication: {
				objectPath: paths.pdf,
				coverObjectPath: paths.cover,
				sizeBytes: downloaded.bytes.byteLength,
				sha256,
				pageCount: processed.pageCount,
				staged: true,
			},
		};
	};

	processor.flushCleanup = (sourceConnectionKey: string) =>
		flushSourceFileCleanup(
			options.database,
			options.storage,
			sourceConnectionKey,
		);
	return processor;
}
