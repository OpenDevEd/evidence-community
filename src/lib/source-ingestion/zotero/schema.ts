import { z } from "zod";

import { tagSchema } from "@/config/library-config/primitives";

const jsonObjectSchema = z.record(z.string(), z.unknown());

/** The publish tags a library starts with; Zotero users tag attachments with them to publish them. */
const DEFAULT_ZOTERO_PUBLISH_TAGS = ["_publish", "publishPDF"] as const;

/**
 * Which of the group's PDFs the library publishes: those whose attachment carries one of `tags`, or every one.
 * The tags also make the group's notes and links public, whichever PDFs are published.
 */
const zoteroPdfPublishingSchema = z
	.object({
		mode: z.enum(["tagged", "every"]),
		tags: z.array(tagSchema).max(10),
	})
	.strict()
	.superRefine((rule, context) => {
		if (rule.mode === "tagged" && rule.tags.length === 0)
			context.addIssue({ code: "custom", message: "Tagged PDFs need at least one publish tag", path: ["tags"] });
		for (const [index, tag] of rule.tags.entries())
			if (rule.tags.indexOf(tag) !== index)
				context.addIssue({ code: "custom", message: "Each publish tag can be listed once", path: ["tags", index] });
	});

const zoteroConnectionSettingsShape = {
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
	// Off, the group adds no PDFs, not even for attachments tagged for publication.
	downloadPdfs: z.boolean().default(true),
};

/** A source's settings as its library configuration gives them; see `withSourcePdfPublishing` for a missing rule. */
export const zoteroSourceSettingsSchema = z
	.object({ ...zoteroConnectionSettingsShape, pdfPublishing: zoteroPdfPublishingSchema.optional() })
	.strict();

/** A connection's settings as the import reads them. */
export const zoteroConnectionConfigSchema = z
	.object({
		...zoteroConnectionSettingsShape,
		pdfPublishing: zoteroPdfPublishingSchema.default({ mode: "tagged", tags: [...DEFAULT_ZOTERO_PUBLISH_TAGS] }),
	})
	.strict();

/** What the import does with the group's PDFs: none, every one, or those carrying a publish tag. */
export type ZoteroPdfRule = { mode: "off" } | { mode: "every" } | { mode: "tagged"; tags: readonly string[] };

export function zoteroPdfRule(config: Pick<z.output<typeof zoteroConnectionConfigSchema>, "downloadPdfs" | "pdfPublishing">): ZoteroPdfRule {
	if (!config.downloadPdfs) return { mode: "off" };
	return config.pdfPublishing.mode === "every" ? { mode: "every" } : { mode: "tagged", tags: config.pdfPublishing.tags };
}

/** The rule as the cursor records it, so a changed rule reads the group again. */
export function zoteroPdfRuleKey(rule: ZoteroPdfRule) {
	return rule.mode === "tagged" ? `tagged:${[...rule.tags].sort().join("\n")}` : rule.mode;
}

export const zoteroGroupResponseSchema = z
	.object({
		data: z.object({ name: z.string().trim().min(1).max(255) }).loose(),
	})
	.loose();

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
			// The PDF rule the last complete read followed (`zoteroPdfRuleKey`). A cursor saved before the rule was
			// recorded has `pdfs: false` when that read left PDFs out, and nothing when it added them.
			pdfRule: z.string().max(4_000).optional(),
			pdfs: z.literal(false).optional(),
			pending: z
				.object({
					offset: z.number().int().nonnegative(),
					snapshotSince: z.number().int().nonnegative(),
					targetVersion: z.number().int().nonnegative(),
					// The PDF rule this read follows; an older pending read has `pdfs: false` when it left PDFs out.
					pdfRule: z.string().max(4_000).optional(),
					pdfs: z.literal(false).optional(),
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
		meta: z
			.object({ parsedDate: z.string().optional() })
			.passthrough()
			.optional(),
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
