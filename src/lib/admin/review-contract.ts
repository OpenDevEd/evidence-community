import { z } from "zod";
import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";

const itemKey = z.string().refine(isCanonicalRecordKey);
export const publishingChoiceSchema = z.discriminatedUnion("route", [
	z.object({ route: z.literal("zenodo"), identifierPolicy: z.literal("mint-zenodo") }),
	z.object({ route: z.literal("crossref-zenodo"), identifierPolicy: z.enum(["reuse-crossref", "mint-zenodo"]) }),
]);
export type PublishingChoice = z.infer<typeof publishingChoiceSchema>;

export const reviewRecordSchema = z.object({
	itemKey,
	baseRevision: z.number().int().nonnegative(),
	payload: z.record(z.string(), z.unknown()),
});
export type ReviewRecord = z.infer<typeof reviewRecordSchema>;

export const reviewSnapshotSchema = z.object({
	records: z.array(reviewRecordSchema).min(1),
	publishingChoice: publishingChoiceSchema.nullable(),
});
export type ReviewSnapshot = z.infer<typeof reviewSnapshotSchema>;

export const reviewFileSchema = z.object({
	itemKey,
	parentItemKey: itemKey,
	uploadRevision: z.number().int().positive(),
	objectPath: z.string().min(1),
	coverObjectPath: z.string().min(1),
	filename: z.string().min(1),
	sha256: z.string().regex(/^[a-f0-9]{64}$/),
	sizeBytes: z.number().int().positive(),
	extractedText: z.string(),
	coverWidth: z.number().int().positive(),
	coverHeight: z.number().int().positive(),
	pageCount: z.number().int().positive(),
});
export type ReviewFile = z.infer<typeof reviewFileSchema>;

export type SavedReview = Omit<typeof import("@/db/schema/review").itemReview.$inferSelect, "submittedAt" | "resolvedAt"> & {
	submittedAt: string;
	resolvedAt: string | null;
};
