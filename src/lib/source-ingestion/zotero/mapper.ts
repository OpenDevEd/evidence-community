import {
	MAX_SOURCE_RECORD_BYTES,
	MAX_SOURCE_RECORD_ISSUE_MESSAGE_LENGTH,
	type SourceIngestionBatch,
} from "../batch-schema";
import type { ZoteroCollectionResponse, ZoteroItemResponse, ZoteroPdfRule } from "./schema";
import type { ZoteroApiClient } from "./client";
import { canonicalZoteroFieldName } from "@opendeved/evidence-library-core/zotero-schema";
import {
	NativeItemValidationError,
	sourceRecordValidationOptions,
	validateNativeItemDraft,
} from "@/lib/admin/native-item-validation";
import { parseBibliographicDate } from "@/lib/bibliographic-date";

type ItemUpsert = Extract<
	SourceIngestionBatch["items"][number],
	{ operation: "upsert" }
>;

export type ZoteroAttachmentProcessorContext = {
	client: ZoteroApiClient;
	prefix: string;
	sourceConnectionKey: string;
	/** Which of the group's PDFs the library publishes. */
	pdfs: ZoteroPdfRule;
};

export type ZoteroAttachmentProcessor = {
	(
		item: ZoteroItemResponse,
		context?: ZoteroAttachmentProcessorContext,
	): Promise<ItemUpsert["file"]>;
	flushCleanup?: (sourceConnectionKey: string) => Promise<void>;
};

export class ZoteroAttachmentPermanentError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly file: ItemUpsert["file"],
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "ZoteroAttachmentPermanentError";
	}
}

const technicalItemFields = new Set([
	"charset",
	"collections",
	"contentType",
	"dateAdded",
	"dateModified",
	"deleted",
	"filename",
	"inPublications",
	"key",
	"lastRead",
	"linkMode",
	"md5",
	"mtime",
	"parentItem",
	"path",
	"version",
]);

function parseDate(value: unknown, field: string) {
	if (value === undefined || value === null || value === "") return null;
	if (typeof value !== "string") {
		throw new Error(`Zotero ${field} must be a date string`);
	}
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		throw new Error(`Zotero ${field} is invalid: ${value}`);
	}
	return parsed;
}

function aliases(item: ZoteroItemResponse) {
	const values = [item.links?.self, item.links?.alternate].flatMap((link) =>
		link?.href ? [{ key: link.href, kind: "zotero-uri" }] : [],
	);
	return [...new Map(values.map((value) => [value.key, value])).values()];
}

function recordBytes(record: SourceIngestionBatch["items"][number]) {
	return Buffer.byteLength(JSON.stringify(record), "utf8");
}

export function fitZoteroFullTextToRecordLimit(
	record: SourceIngestionBatch["items"][number],
) {
	if (record.operation !== "upsert") return record;
	let fitted = record;
	if (
		record.file?.fullText &&
		recordBytes(record) > MAX_SOURCE_RECORD_BYTES
	) {
		const original = Buffer.from(record.file.fullText, "utf8");
		const decoder = new TextDecoder("utf-8", { fatal: true });
		const decodePrefix = (byteLimit: number) => {
			for (
				let end = byteLimit;
				end >= Math.max(0, byteLimit - 3);
				end -= 1
			) {
				try {
					return decoder.decode(original.subarray(0, end));
				} catch {
					// A UTF-8 code point may straddle the byte limit.
				}
			}
			return "";
		};
		let low = 0;
		let high = original.byteLength;
		let best = "";
		while (low <= high) {
			const midpoint = Math.floor((low + high) / 2);
			const candidate = decodePrefix(midpoint);
			const candidateRecord = {
				...record,
				file: { ...record.file, fullText: candidate },
			};
			if (recordBytes(candidateRecord) <= MAX_SOURCE_RECORD_BYTES) {
				best = candidate;
				low = midpoint + 1;
			} else {
				high = midpoint - 1;
			}
		}
		fitted = {
			...record,
			file: { ...record.file, fullText: best },
		};
	}
	if (recordBytes(fitted) <= MAX_SOURCE_RECORD_BYTES) return fitted;

	const title = fitted.metadata.title;
	const earlierIssue = fitted.processingIssue?.message;
	return {
		...fitted,
		raw: {
			_openscholarTruncated: true,
			key: fitted.sourceRecordKey,
			version: fitted.remoteVersion,
		},
		metadata: {
			itemType: fitted.metadata.itemType,
			...(typeof title === "string"
				? { title: title.slice(0, 4096) }
				: {}),
		},
		processingIssue: {
			code: "zotero_record_too_large",
			message: [
				"The Zotero record exceeded the ingestion limit; oversized raw data and metadata were omitted.",
				earlierIssue,
			]
				.filter(Boolean)
				.join(" ")
				.slice(0, MAX_SOURCE_RECORD_ISSUE_MESSAGE_LENGTH),
		},
	};
}

function issueMessage(error: ZoteroAttachmentPermanentError) {
	return (
		error.message.trim().slice(0, MAX_SOURCE_RECORD_ISSUE_MESSAGE_LENGTH) ||
		error.code
	);
}

/**
 * Removes the fields the library cannot store, so one bad value never stops
 * the whole import. The full Zotero record stays in `raw`. Returns what was
 * left out, for the saved record issue.
 */
function dropUnstorableFields(metadata: Record<string, unknown>) {
	const dropped: string[] = [];
	for (;;) {
		try {
			validateNativeItemDraft(metadata, sourceRecordValidationOptions);
			return dropped;
		} catch (error) {
			if (!(error instanceof NativeItemValidationError)) throw error;
			const fields = presentFieldsNamedBy(error, metadata);
			// ponytail: an error that names no present field (for example a
			// malformed annotation) still stops the batch.
			if (fields.size === 0) throw error;
			for (const [field, message] of fields) {
				delete metadata[field];
				dropped.push(`${field} (${message})`);
			}
		}
	}
}

/** The top-level metadata fields a validation error points at, with one message each. */
function presentFieldsNamedBy(
	error: NativeItemValidationError,
	metadata: Record<string, unknown>,
) {
	const fields = new Map<string, string>();
	for (const [path, message] of Object.entries(error.fields)) {
		const field = path.split(".")[0]!;
		if (field === "itemType" || !Object.hasOwn(metadata, field)) continue;
		if (!fields.has(field)) fields.set(field, message);
	}
	return fields;
}

/**
 * Turns Zotero item data into the canonical metadata the native draft
 * validator accepts: technical fields dropped, type-specific field names
 * replaced by their shared names, tags flattened to strings.
 */
export function zoteroDataToCanonicalMetadata(data: {
	itemType: string;
	tags?: readonly { tag: string }[] | null;
	[field: string]: unknown;
}) {
	const metadata = Object.fromEntries(
		Object.entries(data)
			.filter(([field]) => !technicalItemFields.has(field))
			.map(([field, value]) => [
				canonicalZoteroFieldName(data.itemType, field) ?? field,
				value,
			]),
	);
	metadata.tags = (data.tags ?? []).map(({ tag }) => tag);
	return metadata;
}

export function mapZoteroCollection(
	collection: ZoteroCollectionResponse,
): SourceIngestionBatch["collections"][number] {
	return {
		operation: "upsert",
		sourceRecordKey: collection.key,
		remoteVersion: String(collection.version),
		raw: collection as never,
		data: {
			name: collection.data.name,
			numCollections: collection.meta?.numCollections ?? null,
			numItems: collection.meta?.numItems ?? null,
			relations: (collection.data.relations ?? null) as never,
		},
		parentSourceRecordKey:
			typeof collection.data.parentCollection === "string"
				? collection.data.parentCollection
				: null,
	};
}

export async function mapZoteroItem(
	item: ZoteroItemResponse,
	attachmentProcessor?: ZoteroAttachmentProcessor,
	excludedCollectionKeys: ReadonlySet<string> = new Set(),
	attachmentContext?: ZoteroAttachmentProcessorContext,
): Promise<SourceIngestionBatch["items"][number]> {
	if (item.data.deleted === true || item.data.deleted === 1) {
		return {
			operation: "delete",
			sourceRecordKey: item.key,
			remoteVersion: String(item.version),
			raw: item as never,
		};
	}

	const metadata = zoteroDataToCanonicalMetadata(item.data);
	// Zotero keeps the date as typed ("January 1, 2020") and parses it
	// separately. Store the parsed form when the typed one is not storable.
	const parsedDate = item.meta?.parsedDate;
	if (
		typeof metadata.date === "string" &&
		typeof parsedDate === "string" &&
		parseBibliographicDate(metadata.date).kind === "invalid"
	) {
		metadata.date = parsedDate;
	}
	// Left-out fields are the record's main issue; an attachment problem
	// is appended after it.
	const issues: NonNullable<ItemUpsert["processingIssue"]>[] = [];
	const dropped = dropUnstorableFields(metadata);
	if (dropped.length > 0) {
		issues.push({
			code: "zotero_fields_dropped",
			message: `Some fields could not be stored and were left out: ${dropped.join("; ")}.`,
		});
	}
	let file: ItemUpsert["file"] = null;
	if (
		item.data.itemType.toLowerCase() === "attachment" &&
		attachmentProcessor
	) {
		try {
			file = await attachmentProcessor(item, attachmentContext);
		} catch (error) {
			if (!(error instanceof ZoteroAttachmentPermanentError)) throw error;
			file = error.file;
			issues.push({ code: error.code, message: issueMessage(error) });
		}
	}
	const processingIssue: ItemUpsert["processingIssue"] =
		issues.length > 0
			? {
					code: issues[0]!.code,
					message: issues
						.map(({ message }) => message)
						.join(" ")
						.slice(0, MAX_SOURCE_RECORD_ISSUE_MESSAGE_LENGTH),
				}
			: null;

	return fitZoteroFullTextToRecordLimit({
		operation: "upsert",
		sourceRecordKey: item.key,
		remoteVersion: String(item.version),
		raw: item as never,
		metadata: metadata as never,
		parentSourceRecordKey: item.data.parentItem ?? null,
		collections: (item.data.collections ?? [])
			.filter(
				(sourceRecordKey) =>
					!excludedCollectionKeys.has(sourceRecordKey),
			)
			.map((sourceRecordKey) => ({ sourceRecordKey })),
		aliases: aliases(item),
		citationMetric: null,
		referencedSourceRecordKeys: [],
		file,
		processingIssue,
		sourceDates: {
			addedAt: parseDate(item.data.dateAdded, "dateAdded"),
			modifiedAt: parseDate(item.data.dateModified, "dateModified"),
		},
	});
}
