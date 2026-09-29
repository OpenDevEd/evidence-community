import { createHash, randomUUID } from "node:crypto";
import { isSourceConnectionKey } from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { sourceRecordIssue, sourceSnapshot } from "@/db/schema/source";
import type { EvidenceFileStorage } from "@/lib/admin/file-storage";
import { processPdfInWorkers } from "@/lib/admin/pdf-pool";
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

type ProcessorOptions = {
	database: Database;
	storage: EvidenceFileStorage;
	maxPdfBytes: number;
};
type PdfPhase = "download" | "read" | "upload";
type RunOptions = ProcessorOptions & { timings: ReturnType<typeof phaseTimings> };

/** Time spent in each step of publishing PDFs, taken and reset by the import's page log. */
function phaseTimings() {
	const empty = () => ({ count: 0, seconds: 0, slowestSeconds: 0 });
	let phases: Record<PdfPhase, ReturnType<typeof empty>> = { download: empty(), read: empty(), upload: empty() };
	return {
		async time<T>(phase: PdfPhase, step: () => Promise<T>) {
			const started = performance.now();
			try {
				return await step();
			} finally {
				const seconds = (performance.now() - started) / 1000;
				const entry = phases[phase];
				entry.count++;
				entry.seconds += seconds;
				entry.slowestSeconds = Math.max(entry.slowestSeconds, seconds);
			}
		},
		take() {
			const taken = phases;
			phases = { download: empty(), read: empty(), upload: empty() };
			return taken;
		},
	};
}
type SourceFile = NonNullable<SourceItemUpsert["file"]>;
type PdfRecord = SourceItemUpsert & { file: SourceFile & { url: string } };
type Publication = Awaited<ReturnType<typeof readSourceFilePublication>>;
/** The failure code and reusable file at the step that failed. */
type Attempt = { issueCode: string; reusable: SourceItemUpsert["file"] };

function isUnpublishedPdf(record: SourceItemUpsert): record is PdfRecord {
	return (
		record.metadata.itemType === "Attachment" &&
		record.file?.contentType === "application/pdf" &&
		Boolean(record.file.url) &&
		!record.file.managedPublication
	);
}

function assertPublicationIdentity(
	record: SourceItemUpsert,
	sourceConnectionKey: string,
) {
	if (
		!isSourceConnectionKey(sourceConnectionKey) ||
		!/^W\d+:pdf$/u.test(record.sourceRecordKey) ||
		!record.parentSourceRecordKey
	) {
		throw new Error("Invalid OpenAlex attachment publication identity");
	}
}

function reusableFile(existing: Publication, sourceRecordKey: string) {
	const existingFile = sourceFileFromPublication(existing);
	const existingPrefix = `sources/openalex/${existing?.publicationSourceConnectionKey}/${sourceRecordKey}/`;
	return existingFile?.managedPublication?.objectPath.startsWith(
		existingPrefix,
	) &&
		existingFile.managedPublication.coverObjectPath.startsWith(
			existingPrefix,
		)
		? existingFile
		: null;
}

/** The stored publication came from this remote version and PDF URL without an issue. */
async function isUnchangedPublication(
	database: Database,
	record: PdfRecord,
	existing: Publication,
	sourceConnectionKey: string,
) {
	if (
		!existing ||
		record.remoteVersion === null ||
		existing.remoteVersion !== record.remoteVersion
	)
		return false;
	const [issue] = await database
		.select()
		.from(sourceRecordIssue)
		.where(
			and(
				eq(sourceRecordIssue.sourceRecordKey, record.sourceRecordKey),
				inArray(sourceRecordIssue.sourceConnectionKey, [
					sourceConnectionKey,
					existing.publicationSourceConnectionKey!,
				]),
			),
		)
		.limit(1);
	const [snapshot] = await database
		.select({ payload: sourceSnapshot.payload })
		.from(sourceSnapshot)
		.where(
			and(
				eq(sourceSnapshot.itemKey, existing.itemKey),
				eq(
					sourceSnapshot.sourceConnectionKey,
					existing.publicationSourceConnectionKey!,
				),
			),
		)
		.limit(1);
	return (
		!issue &&
		snapshot !== undefined &&
		originalPdfUrl(snapshot.payload) === record.file.url
	);
}

async function publishNewPdf(
	options: RunOptions,
	record: PdfRecord,
	sourceConnectionKey: string,
	bytes: Uint8Array,
	sha256: string,
	attempt: Attempt,
) {
	attempt.issueCode = "openalex_pdf_invalid";
	const processed = await options.timings.time("read", () => processPdfInWorkers(bytes));
	// Never upload over a path queued for deletion by another import.
	const prefix = `sources/openalex/${sourceConnectionKey}/${record.sourceRecordKey}/${sha256}/${randomUUID()}/`;
	const paths = {
		pdf: `${prefix}document.pdf`,
		cover: `${prefix}cover.png`,
	};
	attempt.issueCode = "openalex_pdf_storage_failed";
	const result = withPublishedFile(record, {
		...record.file,
		url: options.storage.publicUrl(paths.pdf),
		filename: record.file.filename ?? `${record.parentSourceRecordKey}.pdf`,
		linkMode: "imported_url",
		md5: createHash("md5").update(bytes).digest("hex"),
		fullText: truncateUtf8(processed.text, MAX_SOURCE_FULL_TEXT_BYTES),
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
	await options.timings.time("upload", () => uploadSourcePublication({
		database: options.database,
		storage: options.storage,
		sourceConnectionKey,
		paths,
		bytes,
		cover: processed.cover,
	}));
	return result;
}

// A slow download may take its full time as long as bytes keep arriving.
const PDF_DOWNLOAD = { accept: "application/pdf", timeoutMs: 120_000, idleTimeoutMs: 30_000 };
const PDF_HEADER = Buffer.from("%PDF-");

const isPdf = (bytes: Uint8Array) => {
	const header = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 1_024)).indexOf(PDF_HEADER);
	return header >= 0;
};

/** The PDF a landing page names in its `citation_pdf_url` meta tag, which scholarly sites publish for indexers. */
function landingPagePdfUrl(html: string, base: URL) {
	for (const tag of html.match(/<meta\b[^>]*>/giu) ?? []) {
		if (!/\bname\s*=\s*["']citation_pdf_url["']/iu.test(tag)) continue;
		const content = /\bcontent\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1]?.replaceAll("&amp;", "&");
		if (!content) return null;
		try {
			const url = new URL(content, base);
			return url.protocol === "https:" || url.protocol === "http:" ? url : null;
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Many OpenAlex PDF links open the article's landing page instead. Its
 * `citation_pdf_url` is followed once, so the PDF behind it is published.
 */
async function downloadPdf(url: URL, maxBytes: number) {
	const { data, contentType, url: landing } = await fetchPublicFile(url, { ...PDF_DOWNLOAD, maxBytes });
	// Some landing pages come without an HTML content type, so the body is looked at too.
	const looksLikeHtml = /html/iu.test(contentType) || /^\s*</u.test(new TextDecoder().decode(data.subarray(0, 512)));
	if (isPdf(data) || !looksLikeHtml) return data;
	const linked = landingPagePdfUrl(new TextDecoder().decode(data), landing);
	if (!linked) return data;
	return (await fetchPublicFile(linked, { ...PDF_DOWNLOAD, maxBytes })).data;
}

async function publishPdf(
	options: RunOptions,
	record: PdfRecord,
	sourceConnectionKey: string,
	attempt: Attempt,
) {
	assertPublicationIdentity(record, sourceConnectionKey);
	const existing = await readSourceFilePublication(
		options.database,
		sourceConnectionKey,
		record.sourceRecordKey,
		true,
	);
	const reusable = reusableFile(existing, record.sourceRecordKey);
	attempt.reusable = reusable;
	if (
		reusable &&
		(await isUnchangedPublication(
			options.database,
			record,
			existing,
			sourceConnectionKey,
		))
	) {
		return withPublishedFile(record, reusable);
	}
	attempt.issueCode = "openalex_pdf_download_failed";
	const bytes = await options.timings.time("download", () => downloadPdf(new URL(record.file.url!), options.maxPdfBytes));
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	if (reusable?.managedPublication?.sha256 === sha256)
		return withPublishedFile(record, reusable);
	return publishNewPdf(
		options,
		record,
		sourceConnectionKey,
		bytes,
		sha256,
		attempt,
	);
}

function failedPdf(
	record: SourceItemUpsert,
	attempt: Attempt,
	error: unknown,
): SourceItemUpsert {
	return {
		...(attempt.reusable
			? withPublishedFile(record, attempt.reusable)
			: record),
		processingIssue: {
			code: attempt.issueCode,
			message:
				`OpenAlex PDF ${record.sourceRecordKey}: ${error instanceof Error ? error.message : String(error)}`.slice(
					0,
					MAX_SOURCE_RECORD_ISSUE_MESSAGE_LENGTH,
				),
		},
	};
}

export function createOpenAlexAttachmentProcessor(processorOptions: ProcessorOptions) {
	if (!Number.isSafeInteger(processorOptions.maxPdfBytes) || processorOptions.maxPdfBytes < 1) {
		throw new Error("OpenAlex maxPdfBytes must be a positive integer");
	}
	const options: RunOptions = { ...processorOptions, timings: phaseTimings() };
	const processor = async (
		record: SourceItemUpsert,
		sourceConnectionKey: string,
	): Promise<SourceItemUpsert> => {
		if (!isUnpublishedPdf(record)) return record;
		const attempt: Attempt = {
			issueCode: "openalex_pdf_storage_failed",
			reusable: null,
		};
		try {
			return await publishPdf(
				options,
				record,
				sourceConnectionKey,
				attempt,
			);
		} catch (error) {
			return failedPdf(record, attempt, error);
		}
	};
	/** Keeps a PDF already published for the record, without downloading anything. */
	processor.reuse = async (
		record: SourceItemUpsert,
		sourceConnectionKey: string,
	): Promise<SourceItemUpsert> => {
		if (!isUnpublishedPdf(record)) return record;
		const existing = await readSourceFilePublication(
			options.database,
			sourceConnectionKey,
			record.sourceRecordKey,
			true,
		);
		const reusable = reusableFile(existing, record.sourceRecordKey);
		if (!reusable) return record;
		// A PDF that changed, or whose last refresh failed, keeps its file until
		// the PDF stage looks again. Without a version it cannot pass as unchanged.
		const unchanged = await isUnchangedPublication(
			options.database,
			record,
			existing,
			sourceConnectionKey,
		);
		return withPublishedFile(
			unchanged ? record : { ...record, remoteVersion: null },
			reusable,
		);
	};
	/** What each publishing step took since the last call, for the PDF stage's log. */
	processor.takeTimings = () => options.timings.take();
	processor.flushCleanup = (sourceConnectionKey: string) =>
		flushSourceFileCleanup(
			options.database,
			options.storage,
			sourceConnectionKey,
		);
	return processor;
}
