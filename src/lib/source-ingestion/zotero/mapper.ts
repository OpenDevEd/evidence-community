import {
	MAX_SOURCE_RECORD_BYTES,
	MAX_SOURCE_RECORD_ISSUE_MESSAGE_LENGTH,
	type SourceIngestionBatch,
} from "../batch-schema";
import type { ZoteroCollectionResponse, ZoteroItemResponse } from "./schema";
import type { ZoteroApiClient } from "./client";

type ItemUpsert = Extract<
	SourceIngestionBatch["items"][number],
	{ operation: "upsert" }
>;

export type ZoteroAttachmentProcessorContext = {
	client: ZoteroApiClient;
	prefix: string;
	sourceConnectionKey: string;
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
			message:
				"The Zotero record exceeded the ingestion limit; oversized raw data and metadata were omitted.",
		},
	};
}

function issueMessage(error: ZoteroAttachmentPermanentError) {
	return (
		error.message.trim().slice(0, MAX_SOURCE_RECORD_ISSUE_MESSAGE_LENGTH) ||
		error.code
	);
}

export function mapZoteroCollection(
	collection: ZoteroCollectionResponse,
): SourceIngestionBatch["collections"][number] {
	return {
		operation: "upsert",
		sourceRecordKey: collection.key,
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

	const metadata = Object.fromEntries(
		Object.entries(item.data).filter(
			([field]) => !technicalItemFields.has(field),
		),
	);
	metadata.tags = (item.data.tags ?? []).map(({ tag }) => tag);
	let file: ItemUpsert["file"] = null;
	let processingIssue: ItemUpsert["processingIssue"] = null;
	if (
		item.data.itemType.toLowerCase() === "attachment" &&
		attachmentProcessor
	) {
		try {
			file = await attachmentProcessor(item, attachmentContext);
		} catch (error) {
			if (!(error instanceof ZoteroAttachmentPermanentError)) throw error;
			file = error.file;
			processingIssue = {
				code: error.code,
				message: issueMessage(error),
			};
		}
	}

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
		file,
		processingIssue,
		sourceDates: {
			addedAt: parseDate(item.data.dateAdded, "dateAdded"),
			modifiedAt: parseDate(item.data.dateModified, "dateModified"),
		},
	});
}
