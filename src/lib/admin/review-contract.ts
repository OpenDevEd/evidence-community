import { z } from "zod";
import type { ZenodoIdentifierPolicy } from "@/db/schema/publication";
import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";

const itemKey = z.string().refine(isCanonicalRecordKey);
export const publishingChoiceSchema = z.discriminatedUnion("route", [
	z.object({ route: z.literal("zenodo"), identifierPolicy: z.literal("mint-zenodo") }),
	z.object({ route: z.literal("crossref-zenodo"), identifierPolicy: z.enum(["reuse-crossref", "mint-zenodo"]) }),
]);
export type PublishingChoice = z.infer<typeof publishingChoiceSchema>;

/** The choice a draft made in the library takes for a DOI route: Zenodo mints its DOI, and on Crossref it reserves one. None publishes without a DOI. */
export const routeChoice = (route: PublishingChoice["route"] | null): PublishingChoice | null =>
	route === "zenodo" ? { identifierPolicy: "mint-zenodo", route } : route && { identifierPolicy: "reuse-crossref", route };
export type PublishingChoiceState = {
	choice: PublishingChoice | null;
	canClear: boolean;
	lockedIdentifierPolicy: ZenodoIdentifierPolicy | null;
};

export const reviewRecordSchema = z.object({
	itemKey,
	baseRevision: z.number().int().nonnegative(),
	payload: z.record(z.string(), z.unknown()),
});
export type ReviewRecord = z.infer<typeof reviewRecordSchema>;

const reviewSnapshotSchema = z.object({
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
