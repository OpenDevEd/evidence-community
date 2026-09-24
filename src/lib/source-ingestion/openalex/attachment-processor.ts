import { createHash } from "node:crypto";
import { isSourceConnectionKey } from "@opendeved/evidence-library-core";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { sourceSnapshot } from "@/db/schema/source";
import type { EvidenceFileStorage } from "@/lib/admin/file-storage";
import { processPdf } from "@/lib/admin/pdf-processing";
import { fetchPublicFile } from "@/lib/public-fetch";
import {
	MAX_SOURCE_FULL_TEXT_BYTES,
	flushSourceFileCleanup,
	readSourceFilePublication,
	sourceFileFromPublication,
	truncateUtf8,
	uploadSourcePublication,
} from "../attachment-storage";
import {
	MAX_SOURCE_RECORD_BYTES,
	MAX_SOURCE_RECORD_ISSUE_MESSAGE_LENGTH,
	type SourceItemUpsert,
} from "../batch-schema";

function originalPdfUrl(raw: Record<string, unknown>) {
	const location = raw.location;
	return location &&
		typeof location === "object" &&
		!Array.isArray(location) &&
		"pdf_url" in location &&
		typeof location.pdf_url === "string"
		? location.pdf_url.trim()
		: null;
}

function withPublishedFile(
	record: SourceItemUpsert,
	file: NonNullable<SourceItemUpsert["file"]>,
): SourceItemUpsert {
	const result = {
		...record,
		metadata: { ...record.metadata, url: file.url },
		file,
	};
	// JSON escaping can exceed the byte limit even after plain UTF-8 text is bounded.
	const fullText = file.fullText ?? "";
	let textBytes = Buffer.byteLength(fullText);
	// ponytail: halve oversized text; exact prefix sizing can replace this if needed.
	while (
		Buffer.byteLength(JSON.stringify(result), "utf8") >
			MAX_SOURCE_RECORD_BYTES &&
		textBytes > 0
	) {
		textBytes = Math.floor(textBytes / 2);
		result.file = { ...file, fullText: truncateUtf8(fullText, textBytes) };
	}
	if (
		Buffer.byteLength(JSON.stringify(result), "utf8") >
		MAX_SOURCE_RECORD_BYTES
	) {
		throw new Error(
			"Processed PDF metadata exceeds the source record limit",
		);
	}
	return result;
}

export function createOpenAlexAttachmentProcessor(options: {
	database: Database;
	storage: EvidenceFileStorage;
	maxPdfBytes: number;
}) {
	if (!Number.isSafeInteger(options.maxPdfBytes) || options.maxPdfBytes < 1) {
		throw new Error("OpenAlex maxPdfBytes must be a positive integer");
	}
	const processor = async (
		record: SourceItemUpsert,
		sourceConnectionKey: string,
	): Promise<SourceItemUpsert> => {
		if (
			record.metadata.itemType !== "Attachment" ||
			record.file?.contentType !== "application/pdf" ||
			!record.file.url ||
			record.file.managedPublication
		)
			return record;
		let issueCode = "openalex_pdf_storage_failed";
		try {
			if (
				!isSourceConnectionKey(sourceConnectionKey) ||
				!/^W\d+:pdf$/u.test(record.sourceRecordKey) ||
				!record.parentSourceRecordKey
			) {
				throw new Error(
					"Invalid OpenAlex attachment publication identity",
				);
			}
			const prefix = `sources/openalex/${sourceConnectionKey}/${record.sourceRecordKey}/`;
			const existing = await readSourceFilePublication(
				options.database,
				sourceConnectionKey,
				record.sourceRecordKey,
			);
			const existingFile = sourceFileFromPublication(existing);
			const reusable =
				existingFile?.managedPublication?.objectPath.startsWith(
					prefix,
				) &&
				existingFile.managedPublication.coverObjectPath.startsWith(
					prefix,
				)
					? existingFile
					: null;
			if (
				reusable &&
				existing &&
				record.remoteVersion !== null &&
				existing.remoteVersion === record.remoteVersion
			) {
				const [snapshot] = await options.database
					.select({ payload: sourceSnapshot.payload })
					.from(sourceSnapshot)
					.where(
						and(
							eq(sourceSnapshot.itemKey, existing.itemKey),
							eq(
								sourceSnapshot.sourceConnectionKey,
								sourceConnectionKey,
							),
						),
					)
					.limit(1);
				if (
					snapshot &&
					originalPdfUrl(snapshot.payload) === record.file.url
				) {
					return withPublishedFile(record, reusable);
				}
			}
			issueCode = "openalex_pdf_download_failed";
			const { data: bytes } = await fetchPublicFile(
				new URL(record.file.url),
				{
					accept: "application/pdf",
					timeoutMs: 120_000,
					maxBytes: options.maxPdfBytes,
				},
			);
			const sha256 = createHash("sha256").update(bytes).digest("hex");
			if (reusable?.managedPublication?.sha256 === sha256)
				return withPublishedFile(record, reusable);
			issueCode = "openalex_pdf_invalid";
			const processed = await processPdf(bytes);
			const paths = {
				pdf: `${prefix}${sha256}/document.pdf`,
				cover: `${prefix}${sha256}/cover.png`,
			};
			issueCode = "openalex_pdf_storage_failed";
			const result = withPublishedFile(record, {
				...record.file,
				url: options.storage.publicUrl(paths.pdf),
				filename:
					record.file.filename ??
					`${record.parentSourceRecordKey}.pdf`,
				linkMode: "imported_url",
				md5: createHash("md5").update(bytes).digest("hex"),
				fullText: truncateUtf8(
					processed.text,
					MAX_SOURCE_FULL_TEXT_BYTES,
				),
				coverUrl: options.storage.publicUrl(paths.cover),
				coverWidth: processed.coverWidth,
				coverHeight: processed.coverHeight,
				managedPublication: {
					objectPath: paths.pdf,
					coverObjectPath: paths.cover,
					sizeBytes: bytes.byteLength,
					sha256,
					pageCount: processed.pageCount,
					staged: true,
				},
			});
			await uploadSourcePublication({
				database: options.database,
				storage: options.storage,
				sourceConnectionKey,
				paths,
				bytes,
				cover: processed.cover,
			});
			return result;
		} catch (error) {
			return {
				...record,
				processingIssue: {
					code: issueCode,
					message:
						`OpenAlex PDF ${record.sourceRecordKey}: ${error instanceof Error ? error.message : String(error)}`.slice(
							0,
							MAX_SOURCE_RECORD_ISSUE_MESSAGE_LENGTH,
						),
				},
			};
		}
	};
	processor.flushCleanup = (sourceConnectionKey: string) =>
		flushSourceFileCleanup(
			options.database,
			options.storage,
			sourceConnectionKey,
		);
	return processor;
}
