import { createHash } from "node:crypto";

import { isSourceConnectionKey } from "@opendeved/evidence-library-core";

import type { Database } from "@/db/database-schema";
import type { EvidenceFileStorage } from "@/lib/admin/file-storage";
import { processPdfInWorkers } from "@/lib/admin/pdf-pool";

import type {
	ZoteroAttachmentProcessor,
	ZoteroAttachmentProcessorContext,
} from "./mapper";
import { ZoteroAttachmentPermanentError } from "./mapper";
import { ZoteroApiError } from "./client";
import type { ZoteroItemResponse, ZoteroPdfRule } from "./schema";

import {
	MAX_SOURCE_FULL_TEXT_BYTES,
	readSourceFilePublication,
	sourceFileFromPublication,
	uploadSourcePublication,
	flushSourceFileCleanup,
	truncateUtf8,
} from "../attachment-storage";
const PDF_CONTENT_TYPE = "application/pdf";
const MD5_PATTERN = /^[0-9a-f]{32}$/u;
const ZOTERO_ITEM_KEY_PATTERN = /^[A-Z0-9]{8}$/u;

type AttachmentProcessorOptions = {
	database: Database;
	maxPdfBytes: number;
	storage: EvidenceFileStorage;
};

export class ZoteroAttachmentProcessingError extends Error {
	constructor(itemKey: string, message: string, options?: ErrorOptions) {
		super(`Zotero attachment ${itemKey}: ${message}`, options);
		this.name = "ZoteroAttachmentProcessingError";
	}
}

function optionalString(value: unknown, maxLength: number) {
	return typeof value === "string" && value.trim().length > 0
		? value.trim().slice(0, maxLength)
		: null;
}

/**
 * Whether the library publishes this attachment's PDF: as an editor chose for it, or by the source's rule, every PDF
 * or one carrying a publish tag. A source that adds no PDFs publishes none.
 */
function isPublished(item: ZoteroItemResponse, rule: ZoteroPdfRule, choice: "publish" | "withhold" | undefined) {
	if (rule.mode === "off") return false;
	if (choice) return choice === "publish";
	if (rule.mode !== "tagged") return rule.mode === "every";
	const itemTags = new Set((item.data.tags ?? []).map(({ tag }) => tag));
	return rule.tags.some((tag) => itemTags.has(tag));
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
		cover: `${root}/cover.jpg`,
		pdf: `${root}/document.pdf`,
	};
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

export function createZoteroAttachmentProcessor(
	options: AttachmentProcessorOptions,
): ZoteroAttachmentProcessor {
	const processor = async (
		item: ZoteroItemResponse,
		context?: ZoteroAttachmentProcessorContext,
	) => {
		const base = baseFile(item);
		if (item.data.contentType !== PDF_CONTENT_TYPE) return base;
		if (!context) {
			throw new Error(
				`Zotero attachment ${item.key}: processor context is missing`,
			);
		}
		if (!isPublished(item, context.pdfs, context.choices?.get(item.key))) return base;
		const linkMode = optionalString(item.data.linkMode, 128);
		if (!item.data.parentItem) {
			throw new ZoteroAttachmentPermanentError(
				"zotero_parent_required",
				`Zotero attachment ${item.key}: a published PDF must have a parent item`,
				base,
			);
		}
		if (linkMode === "linked_url") {
			const url = optionalString(item.data.url, 2048);
			if (!url) {
				throw new ZoteroAttachmentPermanentError(
					"zotero_file_metadata_invalid",
					`Zotero attachment ${item.key}: a published linked URL must have a valid URL`,
					base,
				);
			}
			return { ...base, url };
		}
		if (linkMode !== "imported_file" && linkMode !== "imported_url") {
			throw new ZoteroAttachmentPermanentError(
				"zotero_file_unavailable",
				`Zotero attachment ${item.key}: published PDFs must use linked_url, imported_file, or imported_url storage`,
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

		const existing = await readSourceFilePublication(
			options.database,
			context.sourceConnectionKey,
			item.key,
		);
		const reusable = sourceFileFromPublication(existing);
		if (reusable && existing?.md5?.toLowerCase() === md5) {
			return {
				...base,
				...reusable,
				filename,
				linkMode: base.linkMode ?? existing.linkMode,
				md5,
				mtime: base.mtime ?? existing.mtime,
				charset: base.charset,
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
			processed = await processPdfInWorkers(downloaded.bytes);
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
		await uploadSourcePublication({
			database: options.database,
			storage: options.storage,
			sourceConnectionKey: context.sourceConnectionKey,
			paths,
			bytes: downloaded.bytes,
			cover: processed.cover,
		});

		return {
			...base,
			url: options.storage.publicUrl(paths.pdf),
			contentType: PDF_CONTENT_TYPE,
			filename,
			md5,
			fullText: truncateUtf8(processed.text, MAX_SOURCE_FULL_TEXT_BYTES),
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
