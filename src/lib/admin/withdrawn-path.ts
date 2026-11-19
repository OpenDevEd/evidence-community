import { EvidenceFileStorageError, type EvidenceFileStorage } from "./file-storage";

/**
 * Where a published file waits out of public view: while its record keeps its files from readers, or after the record
 * was removed, until it is restored (withdrawn-files).
 */
export const hiddenPath = (publicPath: string) => `withdrawn/${publicPath}`;

/** A published file's bytes wherever it is: in public view, or out of it (`hiddenPath`). */
export function downloadPublished(storage: EvidenceFileStorage, path: string) {
	return storage.downloadPublic(path).catch((error: unknown) => {
		if (!(error instanceof EvidenceFileStorageError && error.missing)) throw error;
		return storage.downloadPrivate(hiddenPath(path));
	});
}
