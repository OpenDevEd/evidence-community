import { itemFileDraft } from "@opendeved/evidence-library-core";
import { inArray, or } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { itemReviewFile } from "@/db/schema/review";
import { itemFilePublication } from "@/db/schema/source";
import type { EvidenceFileStorage } from "./file-storage";

/** Call after the mutation commits. A review owns its exact private file objects. */
export async function removeUnreferencedPrivateFiles(
	db: Database,
	storage: EvidenceFileStorage,
	paths: string[],
) {
	const candidates = [...new Set(paths)];
	if (!candidates.length) return;
	const references = await Promise.all([
		db.select({ objectPath: itemFileDraft.objectPath, coverObjectPath: itemFileDraft.coverObjectPath })
			.from(itemFileDraft).where(or(inArray(itemFileDraft.objectPath, candidates), inArray(itemFileDraft.coverObjectPath, candidates))),
		db.select({ objectPath: itemFilePublication.sourceObjectPath, coverObjectPath: itemFilePublication.sourceCoverObjectPath })
			.from(itemFilePublication).where(or(inArray(itemFilePublication.sourceObjectPath, candidates), inArray(itemFilePublication.sourceCoverObjectPath, candidates))),
		db.select({ objectPath: itemReviewFile.objectPath, coverObjectPath: itemReviewFile.coverObjectPath })
			.from(itemReviewFile).where(or(inArray(itemReviewFile.objectPath, candidates), inArray(itemReviewFile.coverObjectPath, candidates))),
	]);
	const retained = new Set(references.flat().flatMap((file) => [file.objectPath, file.coverObjectPath]));
	const unused = candidates.filter((path) => !retained.has(path));
	if (unused.length) await storage.removePrivate(unused);
}
