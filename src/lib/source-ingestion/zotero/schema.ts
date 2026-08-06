import { z } from "zod";

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const zoteroConnectionConfigSchema = z
	.object({
		apiBaseUrl: z.string().url().default("https://api.zotero.org"),
		attachmentDownloadTimeoutMs: z
			.number()
			.int()
			.min(1_000)
			.max(900_000)
			.default(120_000),
		maxConsistencyRetries: z.number().int().min(1).max(10).default(4),
		maxRecordsPerBatch: z.number().int().min(1).max(1_000).default(500),
		maxSnapshotRecords: z
			.number()
			.int()
			.min(1)
			.max(1_000_000)
			.default(100_000),
		requestTimeoutMs: z
			.number()
			.int()
			.min(1_000)
			.max(120_000)
			.default(30_000),
	})
	.strict();

export const zoteroKeyAccessSchema = z
	.object({
		access: z
			.object({
				groups: z
					.record(
						z.string(),
						z
							.object({
								library: z.boolean().optional(),
								write: z.boolean().optional(),
							})
							.passthrough(),
					)
					.optional(),
				user: z
					.object({
						library: z.boolean().optional(),
						write: z.boolean().optional(),
					})
					.passthrough()
					.optional(),
			})
			.passthrough(),
		userID: z.number().int().nonnegative(),
	})
	.passthrough();

export const zoteroWriteResponseSchema = z
	.object({
		failed: z
			.record(
				z.string(),
				z
					.object({
						code: z.number().int(),
						message: z.string(),
					})
					.passthrough(),
			)
			.default({}),
		success: z.record(z.string(), z.unknown()).default({}),
		successful: z.record(z.string(), z.unknown()).default({}),
		unchanged: z.record(z.string(), z.unknown()).default({}),
	})
	.passthrough();

export const zoteroCursorSchema = z.union([
	z.object({}).strict(),
	z
		.object({
			libraryVersion: z.number().int().nonnegative(),
			softTrashedCollectionKeys: z.array(z.string().min(1).max(512)),
			softTrashedItemKeys: z.array(z.string().min(1).max(512)),
			pending: z
				.object({
					offset: z.number().int().nonnegative(),
					snapshotSince: z.number().int().nonnegative(),
					targetVersion: z.number().int().nonnegative(),
				})
				.strict()
				.optional(),
		})
		.strict(),
]);

export const zoteroVersionsSchema = z.record(
	z.string().min(1).max(512),
	z.number().int().nonnegative(),
);

export const zoteroDeletedSchema = z
	.object({
		collections: z.array(z.string().min(1).max(512)).default([]),
		items: z.array(z.string().min(1).max(512)).default([]),
		searches: z.array(z.string()).default([]),
		tags: z.array(z.string()).default([]),
	})
	.passthrough();

const zoteroLinksSchema = z
	.record(
		z.string(),
		z
			.object({
				href: z.string().url(),
			})
			.passthrough(),
	)
	.optional();

export const zoteroCollectionResponseSchema = z
	.object({
		data: jsonObjectSchema.and(
			z.object({
				deleted: z.union([z.boolean(), z.number()]).optional(),
				name: z.string(),
				parentCollection: z
					.union([z.string(), z.literal(false)])
					.optional(),
				relations: jsonObjectSchema.optional(),
			}),
		),
		key: z.string().min(1).max(512),
		links: zoteroLinksSchema,
		meta: z
			.object({
				numCollections: z.number().int().nonnegative().optional(),
				numItems: z.number().int().nonnegative().optional(),
			})
			.passthrough()
			.optional(),
		version: z.number().int().nonnegative(),
	})
	.passthrough();

export const zoteroItemResponseSchema = z
	.object({
		data: jsonObjectSchema.and(
			z.object({
				collections: z.array(z.string()).optional(),
				dateAdded: z.string().optional(),
				dateModified: z.string().optional(),
				deleted: z.union([z.boolean(), z.number()]).optional(),
				itemType: z.string().min(1),
				parentItem: z.string().optional(),
				tags: z
					.array(z.object({ tag: z.string() }).passthrough())
					.optional(),
			}),
		),
		key: z.string().min(1).max(512),
		links: zoteroLinksSchema,
		version: z.number().int().nonnegative(),
	})
	.passthrough();

export type ZoteroConnectionConfig = z.infer<
	typeof zoteroConnectionConfigSchema
>;
export type ZoteroCursor = z.infer<typeof zoteroCursorSchema>;
export type ZoteroCollectionResponse = z.infer<
	typeof zoteroCollectionResponseSchema
>;
export type ZoteroItemResponse = z.infer<typeof zoteroItemResponseSchema>;
