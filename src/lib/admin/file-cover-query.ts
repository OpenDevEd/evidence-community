import { and, eq, isNotNull } from "drizzle-orm";
import { itemFileDraft } from "@opendeved/evidence-library-core";
import type { Database } from "@/db/database-schema";
import { itemReviewFile } from "@/db/schema/review";
import type { EvidenceFileStorage } from "./file-storage";
import { ItemNotFoundError } from "./native-item-service";

/** A submitted cover must come from its frozen review, never the working file. */
export async function getAdminPdfCover(
	db: Database,
	storage: EvidenceFileStorage,
	itemKey: string,
	revision: number,
	reviewId?: string,
) {
	let path: string | null | undefined;
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
		if (snapshot?.file?.uploadRevision === revision)
			path = snapshot.coverObjectPath;
	} else {
		const [draft] = await db
			.select({ path: itemFileDraft.coverObjectPath })
			.from(itemFileDraft)
			.where(
				and(
					eq(itemFileDraft.itemKey, itemKey),
					eq(itemFileDraft.uploadRevision, revision),
					isNotNull(itemFileDraft.readyAt),
				),
			);
		path = draft?.path;
	}
	if (!path) throw new ItemNotFoundError(itemKey);
	return storage.downloadPrivate(path);
}
