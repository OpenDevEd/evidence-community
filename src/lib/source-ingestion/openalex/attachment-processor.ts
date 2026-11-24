import { createHash, randomUUID } from "node:crypto";
import { isSourceConnectionKey } from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { sourceRecordIssue, sourceSnapshot } from "@/db/schema/source";
import type { EvidenceFileStorage } from "@/lib/admin/file-storage";
import { processPdfInWorkers } from "@/lib/admin/pdf-pool";
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
import { PDF_RECORD } from "../openscholar/report-record";
import { PdfNotFound, downloadPaperPdf, pdfSearchMemory, pdfSearchQueue } from "./pdf-download";

/** The address a record's PDF came from: an OpenAlex location's, or an Openscholar Report's own (report-record.ts). */
function originalPdfUrl(raw: Record<string, unknown>) {
	const location = raw.location;
	if (typeof raw.openscholarReport === "string" && typeof raw.url === "string") return raw.url.trim();
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
type RunOptions = ProcessorOptions & { timings: ReturnType<typeof phaseTimings>; memory: ReturnType<typeof pdfSearchMemory> };

/**
 * Time spent in each step of publishing PDFs, per source, taken and reset by
 * that source's page log. One processor serves every source a runtime syncs.
 */
function phaseTimings() {
	const empty = () => ({ count: 0, seconds: 0, slowestSeconds: 0 });
	const fresh = () => ({ download: empty(), read: empty(), upload: empty() });
	const bySource = new Map<string, Record<PdfPhase, ReturnType<typeof empty>>>();
	return {
		async time<T>(sourceConnectionKey: string, phase: PdfPhase, step: () => Promise<T>) {
			const started = performance.now();
			try {
				return await step();
			} finally {
				const seconds = (performance.now() - started) / 1000;
				if (!bySource.has(sourceConnectionKey)) bySource.set(sourceConnectionKey, fresh());
				const entry = bySource.get(sourceConnectionKey)![phase];
				entry.count++;
				entry.seconds += seconds;
				entry.slowestSeconds = Math.max(entry.slowestSeconds, seconds);
			}
		},
		take(sourceConnectionKey: string) {
			const taken = bySource.get(sourceConnectionKey) ?? fresh();
			bySource.delete(sourceConnectionKey);
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
		!(/^W\d+:pdf$/u.test(record.sourceRecordKey) || record.sourceRecordKey.startsWith(PDF_RECORD)) ||
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

/**
 * The stored publication came from this PDF URL without an issue. OpenAlex
 * bumps a work's version for any change, such as a citation count, so the
 * version only matters when the records stage cleared it to ask for a look.
 */
async function isUnchangedPublication(
	database: Database,
	record: PdfRecord,
	existing: Publication,
	sourceConnectionKey: string,
) {
	if (!existing || existing.remoteVersion === null) return false;
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
	const processed = await options.timings.time(sourceConnectionKey, "read", () => processPdfInWorkers(bytes));
	// Never upload over a path queued for deletion by another import.
	const prefix = `sources/openalex/${sourceConnectionKey}/${record.sourceRecordKey}/${sha256}/${randomUUID()}/`;
	const paths = {
		pdf: `${prefix}document.pdf`,
		cover: `${prefix}cover.jpg`,
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
	await options.timings.time(sourceConnectionKey, "upload", () => uploadSourcePublication({
		database: options.database,
		storage: options.storage,
		sourceConnectionKey,
		paths,
		bytes,
		cover: processed.cover,
	}));
	return result;
}

async function publishPdf(
	options: RunOptions,
	record: PdfRecord,
	sourceConnectionKey: string,
	attempt: Attempt,
	quick: boolean,
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
	const bytes = await options.timings.time(sourceConnectionKey, "download", () =>
		downloadPaperPdf(record.file.url, record.raw, {
			maxBytes: options.maxPdfBytes,
			memory: options.memory,
			// An OpenAlex work's PDF record is keyed by the work. An Openscholar Report's has no OpenAlex ID.
			openalexId: /^W\d+$/u.test(record.parentSourceRecordKey ?? "") ? record.parentSourceRecordKey! : undefined,
			quick,
		}),
	);
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
	const options: RunOptions = { ...processorOptions, timings: phaseTimings(), memory: pdfSearchMemory(processorOptions.database) };
	const queue = pdfSearchQueue(processorOptions.database);
	const publish = async (record: SourceItemUpsert, sourceConnectionKey: string, quick: boolean): Promise<SourceItemUpsert> => {
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
				quick,
			);
		} catch (error) {
			// The quick search's miss waits for the full search, unless an earlier full search remembered there is no copy.
			if (error instanceof PdfNotFound && !error.full && !error.miss.remembered) await queue.add(sourceConnectionKey, record);
			return failedPdf(record, attempt, error);
		}
	};
	/** Publishes a record's PDF after the full search: its own links, then Crossref and the Internet Archive. */
	const processor = (record: SourceItemUpsert, sourceConnectionKey: string) => publish(record, sourceConnectionKey, false);
	/**
	 * Publishes a record's PDF after the quick search: its own links and what their pages lead to. For an import of
	 * many, whose pages should not wait on services that answer at their own pace. A record it misses is given by
	 * `pending` until `searched` says the full search has been run on it.
	 */
	processor.quick = (record: SourceItemUpsert, sourceConnectionKey: string) => publish(record, sourceConnectionKey, true);
	processor.pending = queue.take;
	processor.searched = queue.done;
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
		// A PDF whose URL changed, or whose last refresh failed, keeps its file
		// until the PDF stage looks again. Clearing its version asks for that look.
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
	processor.takeTimings = (sourceConnectionKey: string) => options.timings.take(sourceConnectionKey);
	processor.flushCleanup = (sourceConnectionKey: string) =>
		flushSourceFileCleanup(
			options.database,
			options.storage,
			sourceConnectionKey,
		);
	return processor;
}
