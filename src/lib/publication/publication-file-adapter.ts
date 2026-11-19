import type {
	PublicationFile,
	PublicationFileReader,
} from "@opendeved/doi-sync-core";

import type { EvidenceFileStorage } from "@/lib/admin/file-storage";
import { downloadPublished } from "@/lib/admin/withdrawn-path";
import type { PublicationRepositorySnapshot } from "./repository";

type PublishedFile = PublicationRepositorySnapshot["files"][number];

export class PublicationFileUnavailableError extends Error {
	constructor(fileKey: string, reason: string) {
		super(`Published file ${fileKey} ${reason}`);
		this.name = "PublicationFileUnavailableError";
	}
}

function assertCurrentFile(row: PublishedFile, file: PublicationFile) {
	if (
		row.revision !== file.publicationRevision ||
		row.filename !== file.filename ||
		row.contentType !== file.contentType ||
		row.sizeBytes !== file.size ||
		row.sha256.toLowerCase() !== file.sha256.toLowerCase()
	) {
		throw new PublicationFileUnavailableError(
			file.fileKey,
			"changed after this Zenodo job was planned. Run the job again.",
		);
	}
}

export function createPublicationFileReader(
	storage: EvidenceFileStorage,
	rows: readonly PublishedFile[],
): PublicationFileReader {
	const rowsByKey = new Map(rows.map((row) => [row.itemKey, row]));
	return {
		async readFile(file) {
			const row = rowsByKey.get(file.fileKey);
			if (!row) {
				throw new PublicationFileUnavailableError(
					file.fileKey,
					"is no longer published. Publish it again before retrying Zenodo.",
				);
			}
			assertCurrentFile(row, file);
			// A private or withdrawn record's file is out of public view (withdrawn-files) while its Zenodo upload may be due.
			return downloadPublished(storage, row.objectPath);
		},
	};
}
