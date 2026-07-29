import type { SourceIngestionBatch } from "../batch-schema";
import type {
	ZoteroCollectionResponse,
	ZoteroItemResponse,
} from "./schema";

type ItemUpsert = Extract<
	SourceIngestionBatch["items"][number],
	{ operation: "upsert" }
>;

export type ZoteroAttachmentProcessor = (
	item: ZoteroItemResponse,
) => Promise<ItemUpsert["file"]>;

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
	const values = Object.values(item.links ?? {}).flatMap((link) =>
		link.href ? [{ key: link.href, kind: "zotero-uri" }] : [],
	);
	return [...new Map(values.map((value) => [value.key, value])).values()];
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

	return {
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
		file:
			item.data.itemType.toLowerCase() === "attachment" &&
			attachmentProcessor
				? await attachmentProcessor(item)
				: null,
		sourceDates: {
			addedAt: parseDate(item.data.dateAdded, "dateAdded"),
			modifiedAt: parseDate(item.data.dateModified, "dateModified"),
		},
	};
}
