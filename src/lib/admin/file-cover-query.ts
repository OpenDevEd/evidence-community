import { and, eq, isNotNull } from "drizzle-orm";
import { itemFileDraft } from "@opendeved/evidence-library-core";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { Database } from "@/db/database-schema";
import { itemReviewFile } from "@/db/schema/review";
import { ADMIN_CONTENT_PERMISSION } from "./access";
import type { EvidenceFileStorage } from "./file-storage";
import { getNativeFileRuntime } from "./file-runtime";
import { ADMIN_RESPONSE_HEADERS, handleAdminResponse } from "./http";
import { ItemNotFoundError } from "./native-item-service";

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

export async function getAdminPdfObject(
	db: Database,
	storage: EvidenceFileStorage,
	itemKey: string,
	revision: number,
	object: PdfObject,
	reviewId?: string,
) {
	const located = await locateAdminPdfObject(db, itemKey, revision, object, reviewId);
	if (!located?.path) throw new ItemNotFoundError(itemKey);
	return { bytes: await storage.downloadPrivate(located.path), filename: located.filename };
}

const pdfObjectRequest = z.object({
	revision: z.coerce.number().int().positive(),
	review: z.string().uuid().optional(),
});

const PDF_OBJECT_HEADERS: Record<PdfObject, (filename: string) => Record<string, string>> = {
	cover: () => ({ "Content-Type": "image/png" }),
	file: (filename) => ({
		"Content-Type": "application/pdf",
		"Content-Disposition": `inline; filename="${filename.replace(/["\\\r\n]/g, "_")}"`,
	}),
};

/** Serves a staged or submitted PDF object to an admin; published files are served from public storage instead. */
export function handleAdminPdfObjectRequest(
	request: NextRequest,
	params: Promise<{ key: string }>,
	object: PdfObject,
) {
	return handleAdminResponse(request, ADMIN_CONTENT_PERMISSION, async () => {
		const [{ key }, runtime] = await Promise.all([params, getNativeFileRuntime()]);
		const { revision, review } = pdfObjectRequest.parse(
			Object.fromEntries(request.nextUrl.searchParams),
		);
		const { bytes, filename } = await getAdminPdfObject(
			runtime.db,
			runtime.storage,
			key,
			revision,
			object,
			review,
		);
		return new NextResponse(new Uint8Array(bytes), {
			headers: {
				...ADMIN_RESPONSE_HEADERS,
				...PDF_OBJECT_HEADERS[object](filename),
				"X-Content-Type-Options": "nosniff",
			},
		});
	});
}
