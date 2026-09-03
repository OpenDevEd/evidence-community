import {
	isSourceConnectionKey,
	SOURCE_CONNECTION_KEY_PATTERN,
} from "@opendeved/evidence-library-core";
import { z } from "zod";

export type JsonValue =
	| boolean
	| null
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number().finite(),
		z.boolean(),
		z.null(),
		z.array(jsonValueSchema),
		z.record(z.string(), jsonValueSchema),
	]),
);

export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
export const MAX_SOURCE_RECORD_BYTES = 2 * 1024 * 1024;
export const MAX_SOURCE_BATCH_BYTES = 64 * 1024 * 1024;
export const MAX_SOURCE_RECORD_ISSUE_MESSAGE_LENGTH = 4096;
const sourceRecordKeySchema = z.string().trim().min(1).max(512);
const nullableRemoteVersionSchema = z
	.string()
	.max(255)
	.nullable()
	.default(null);

const sourceRecordIssueSchema = z
	.object({
		code: z.string().trim().min(1).max(64),
		message: z
			.string()
			.trim()
			.min(1)
			.max(MAX_SOURCE_RECORD_ISSUE_MESSAGE_LENGTH),
	})
	.strict();

const sourceRecordAliasSchema = z
	.object({
		key: z.string().trim().min(1).max(512),
		kind: z.string().trim().min(1).max(64),
	})
	.strict();

const sourceCitationMetricSchema = z
	.object({
		citedByCount: z.number().int().nonnegative().nullable().default(null),
		referencedWorksCount: z
			.number()
			.int()
			.nonnegative()
			.nullable()
			.default(null),
	})
	.strict()
	.refine(
		(metric) =>
			metric.citedByCount !== null ||
			metric.referencedWorksCount !== null,
		"A source citation metric must contain at least one count",
	);

const collectionReferenceSchema = z
	.object({
		sourceConnectionKey: z
			.string()
			.min(1)
			.max(64)
			.regex(SOURCE_CONNECTION_KEY_PATTERN)
			.optional(),
		sourceRecordKey: sourceRecordKeySchema,
	})
	.strict();

const managedFilePublicationSchema = z
	.object({
		objectPath: z.string().trim().min(1).max(1024),
		coverObjectPath: z.string().trim().min(1).max(1024),
		sizeBytes: z.number().int().positive(),
		sha256: z.string().regex(/^[0-9a-f]{64}$/u),
		pageCount: z.number().int().positive(),
		staged: z.boolean(),
	})
	.strict();

const attachmentFileSchema = z
	.object({
		url: z.string().url().max(2048).nullable().default(null),
		contentType: z.string().trim().min(1).max(128).nullable().default(null),
		filename: z.string().trim().min(1).max(255).nullable().default(null),
		linkMode: z.string().trim().min(1).max(128).nullable().default(null),
		md5: z.string().trim().min(1).max(255).nullable().default(null),
		mtime: z.string().trim().min(1).max(255).nullable().default(null),
		charset: z.string().trim().min(1).max(128).nullable().default(null),
		fullText: z.string().nullable().default(null),
		coverUrl: z.string().url().max(2048).nullable().default(null),
		coverWidth: z.number().int().positive().nullable().default(null),
		coverHeight: z.number().int().positive().nullable().default(null),
		managedPublication: managedFilePublicationSchema
			.nullable()
			.default(null),
	})
	.strict()
	.superRefine((file, context) => {
		const coverValues = [file.coverUrl, file.coverWidth, file.coverHeight];
		const populated = coverValues.filter((value) => value !== null);
		if (populated.length > 0 && populated.length !== coverValues.length) {
			context.addIssue({
				code: "custom",
				message:
					"coverUrl, coverWidth, and coverHeight must be provided together",
			});
		}
		if (
			file.managedPublication &&
			(file.url === null ||
				file.contentType !== "application/pdf" ||
				file.filename === null ||
				file.md5 === null ||
				file.coverUrl === null ||
				file.coverWidth === null ||
				file.coverHeight === null ||
				file.fullText === null)
		) {
			context.addIssue({
				code: "custom",
				message:
					"managedPublication requires PDF metadata, public file, cover, dimensions, and extracted text",
			});
		}
		if (
			file.managedPublication &&
			(file.md5 === null || !/^[0-9a-f]{32}$/u.test(file.md5))
		) {
			context.addIssue({
				code: "custom",
				path: ["md5"],
				message: "managedPublication requires a lowercase MD5 checksum",
			});
		}
	});

const sourceDatesSchema = z
	.object({
		addedAt: z.date().nullable().default(null),
		modifiedAt: z.date().nullable().default(null),
	})
	.strict();

const itemUpsertSchema = z
	.object({
		operation: z.literal("upsert"),
		sourceRecordKey: sourceRecordKeySchema,
		remoteVersion: nullableRemoteVersionSchema,
		raw: jsonObjectSchema,
		metadata: jsonObjectSchema,
		parentSourceRecordKey: sourceRecordKeySchema.nullable().default(null),
		collections: z.array(collectionReferenceSchema).max(1_000).default([]),
		aliases: z.array(sourceRecordAliasSchema).max(1_000).default([]),
		citationMetric: sourceCitationMetricSchema.nullable().default(null),
		referencedSourceRecordKeys: z
			.array(sourceRecordKeySchema)
			.max(10_000)
			.default([]),
		file: attachmentFileSchema.nullable().default(null),
		processingIssue: sourceRecordIssueSchema.nullable().default(null),
		sourceDates: sourceDatesSchema.nullable().default(null),
	})
	.strict();

const itemDeleteSchema = z
	.object({
		operation: z.literal("delete"),
		sourceRecordKey: sourceRecordKeySchema,
		remoteVersion: nullableRemoteVersionSchema,
		raw: jsonObjectSchema.default({ deleted: true }),
	})
	.strict();

const collectionDataSchema = z
	.object({
		name: z.string().max(4_096).nullable().default(null),
		numCollections: z.number().int().nonnegative().nullable().default(null),
		numItems: z.number().int().nonnegative().nullable().default(null),
		relations: jsonObjectSchema.nullable().default(null),
	})
	.strict();

const collectionUpsertSchema = z
	.object({
		operation: z.literal("upsert"),
		sourceRecordKey: sourceRecordKeySchema,
		remoteVersion: nullableRemoteVersionSchema,
		raw: jsonObjectSchema.default({}),
		data: collectionDataSchema,
		parentSourceRecordKey: sourceRecordKeySchema.nullable().default(null),
	})
	.strict();

const collectionDeleteSchema = z
	.object({
		operation: z.literal("delete"),
		sourceRecordKey: sourceRecordKeySchema,
		remoteVersion: nullableRemoteVersionSchema,
		raw: jsonObjectSchema.default({ deleted: true }),
	})
	.strict();

export const sourceIngestionBatchSchema = z
	.object({
		sourceConnectionKey: z
			.string()
			.refine(isSourceConnectionKey, "Invalid source connection key"),
		expectedCursor: jsonObjectSchema,
		nextCursor: jsonObjectSchema,
		mappingProfileVersion: z.string().trim().min(1).max(64),
		fetchedAt: z.date(),
		items: z
			.array(
				z.discriminatedUnion("operation", [
					itemUpsertSchema,
					itemDeleteSchema,
				]),
			)
			.max(5_000)
			.default([]),
		collections: z
			.array(
				z.discriminatedUnion("operation", [
					collectionUpsertSchema,
					collectionDeleteSchema,
				]),
			)
			.max(5_000)
			.default([]),
	})
	.strict()
	.superRefine((batch, context) => {
		let batchBytes = 0;
		for (const [field, records] of [
			["items", batch.items],
			["collections", batch.collections],
		] as const) {
			const seen = new Set<string>();
			records.forEach((record, index) => {
				const recordBytes = Buffer.byteLength(
					JSON.stringify(record),
					"utf8",
				);
				batchBytes += recordBytes;
				if (recordBytes > MAX_SOURCE_RECORD_BYTES) {
					context.addIssue({
						code: "custom",
						message: `Source record exceeds ${MAX_SOURCE_RECORD_BYTES} bytes`,
						path: [field, index],
					});
				}
				if (seen.has(record.sourceRecordKey)) {
					context.addIssue({
						code: "custom",
						message: `Duplicate ${field} sourceRecordKey`,
						path: [field, index, "sourceRecordKey"],
					});
				}
				seen.add(record.sourceRecordKey);
			});
		}

		const aliases = new Set<string>();
		batch.items.forEach((record, itemIndex) => {
			if (record.operation !== "upsert") return;
			const collectionReferences = new Set<string>();
			record.collections.forEach((reference, referenceIndex) => {
				const connectionKey =
					reference.sourceConnectionKey ?? batch.sourceConnectionKey;
				const identity = `${connectionKey}\u0000${reference.sourceRecordKey}`;
				if (collectionReferences.has(identity)) {
					context.addIssue({
						code: "custom",
						message: "Duplicate collection reference",
						path: [
							"items",
							itemIndex,
							"collections",
							referenceIndex,
						],
					});
				}
				collectionReferences.add(identity);
			});
			record.aliases.forEach((alias, aliasIndex) => {
				if (aliases.has(alias.key)) {
					context.addIssue({
						code: "custom",
						message: "Duplicate item alias key",
						path: [
							"items",
							itemIndex,
							"aliases",
							aliasIndex,
							"key",
						],
					});
				}
				aliases.add(alias.key);
			});
		});
		if (batchBytes > MAX_SOURCE_BATCH_BYTES) {
			context.addIssue({
				code: "custom",
				message: `Source batch exceeds ${MAX_SOURCE_BATCH_BYTES} bytes`,
				path: [],
			});
		}
	});

export type SourceIngestionBatch = z.infer<typeof sourceIngestionBatchSchema>;
export type SourceItemUpsert = Extract<
	SourceIngestionBatch["items"][number],
	{ operation: "upsert" }
>;
export type SourceCollectionUpsert = Extract<
	SourceIngestionBatch["collections"][number],
	{ operation: "upsert" }
>;
