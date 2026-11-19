import { and, eq, isNotNull } from "drizzle-orm";
import { itemFileDraft } from "@opendeved/evidence-library-core";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { Database } from "@/db/database-schema";
import { itemReviewFile } from "@/db/schema/review";
import { itemFilePublication } from "@/db/schema/source";
import { hiddenPath } from "./withdrawn-path";
import { ADMIN_CONTENT_PERMISSION } from "./access";
import { EvidenceFileStorageError, type EvidenceFileStorage } from "./file-storage";
import { getNativeFileRuntime } from "./file-runtime";
import { ADMIN_RESPONSE_HEADERS, handleAdminResponse } from "./http";
import { ItemNotFoundError } from "./native-item-service";
import { coverContentType } from "./pdf-processing";

type PdfObject = "cover" | "file";

/** A submitted PDF, or its cover, must come from its frozen review, never the working file. */
async function locateAdminPdfObject(
	db: Database,
	itemKey: string,
	revision: number,
	object: PdfObject,
	reviewId?: string,
) {
	if (reviewId) {
		const [snapshot] = await db
			.select()
			.from(itemReviewFile)
			.where(
				and(
					eq(itemReviewFile.reviewId, reviewId),
					eq(itemReviewFile.itemKey, itemKey),
				),
			);
		if (snapshot?.file?.uploadRevision !== revision) return null;
		return {
			path: object === "cover" ? snapshot.coverObjectPath : snapshot.objectPath,
			filename: snapshot.file.filename,
		};
	}
	const [draft] = await db
		.select({
			path: object === "cover" ? itemFileDraft.coverObjectPath : itemFileDraft.objectPath,
			filename: itemFileDraft.filename,
		})
		.from(itemFileDraft)
		.where(
			and(
				eq(itemFileDraft.itemKey, itemKey),
				eq(itemFileDraft.uploadRevision, revision),
				isNotNull(itemFileDraft.readyAt),
			),
		);
	return draft ?? null;
}

/**
 * A published file, or its cover, out of public view: where its record keeps it while readers can't have it, or still
 * in public view when that move hasn't run yet (`placeRecordFiles`).
 */
async function getPublishedPdfObject(db: Database, storage: EvidenceFileStorage, itemKey: string, revision: number, object: PdfObject) {
	const [row] = await db
		.select({ path: object === "cover" ? itemFilePublication.coverObjectPath : itemFilePublication.objectPath, filename: itemFilePublication.filename })
		.from(itemFilePublication)
		.where(and(eq(itemFilePublication.itemKey, itemKey), eq(itemFilePublication.uploadRevision, revision)));
	if (!row?.path) throw new ItemNotFoundError(itemKey);
	const path = row.path;
	const bytes = await storage.downloadPrivate(hiddenPath(path)).catch((error: unknown) => {
		if (error instanceof EvidenceFileStorageError && error.missing) return storage.downloadPublic(path);
		throw error;
	});
	return { bytes, filename: row.filename, path };
}

export async function getAdminPdfObject(
	db: Database,
	storage: EvidenceFileStorage,
	itemKey: string,
	revision: number,
	object: PdfObject,
	reviewId?: string,
	published = false,
) {
	if (published) return getPublishedPdfObject(db, storage, itemKey, revision, object);
	const located = await locateAdminPdfObject(db, itemKey, revision, object, reviewId);
	if (!located?.path) throw new ItemNotFoundError(itemKey);
	return { bytes: await storage.downloadPrivate(located.path), ...located, path: located.path };
}

const pdfObjectRequest = z.object({
	revision: z.coerce.number().int().positive(),
	review: z.string().uuid().optional(),
	published: z.literal("1").optional(),
});

const PDF_OBJECT_HEADERS: Record<PdfObject, (located: { filename: string; path: string }) => Record<string, string>> = {
	cover: ({ path }) => ({ "Content-Type": coverContentType(path) }),
	file: ({ filename }) => ({
		"Content-Type": "application/pdf",
		"Content-Disposition": `inline; filename="${filename.replace(/["\\\r\n]/g, "_")}"`,
	}),
};

/** Serves a staged or submitted PDF object to an admin, or a published one its record keeps out of public view. */
export function handleAdminPdfObjectRequest(
	request: NextRequest,
	params: Promise<{ key: string }>,
	object: PdfObject,
) {
	return handleAdminResponse(request, ADMIN_CONTENT_PERMISSION, async () => {
		const [{ key }, runtime] = await Promise.all([params, getNativeFileRuntime()]);
		const { revision, review, published } = pdfObjectRequest.parse(
			Object.fromEntries(request.nextUrl.searchParams),
		);
		const { bytes, ...located } = await getAdminPdfObject(
			runtime.db,
			runtime.storage,
			key,
			revision,
			object,
			review,
			published === "1",
		);
		return new NextResponse(new Uint8Array(bytes), {
			headers: {
				...ADMIN_RESPONSE_HEADERS,
				...PDF_OBJECT_HEADERS[object](located),
				"X-Content-Type-Options": "nosniff",
			},
		});
	});
}
