import {
	parsePublicationFileManifest,
	parsePublicationIdentifiers,
	parsePublicationRecordSnapshot,
	type PublicationFileManifest,
	type PublicationIdentifiers,
	type PublicationRecordSnapshot,
} from "@opendeved/doi-sync-core";
import {
	publicationRecordMetadata,
	type EvidenceLibraryPublicationMetadata,
} from "./record-metadata";
import type { PublicationRecordExtras } from "./record-extras";
import { licenceComplete } from "@/lib/licences";

export type EvidenceLibraryPublicationRecord =
	EvidenceLibraryPublicationMetadata & {
		key: string;
		revision: number;
	};

export type EvidenceLibraryPublishedFile = {
	itemKey: string;
	revision: number;
	filename: string;
	contentType: string;
	sizeBytes: number;
	sha256: string;
	md5: string;
};

export function buildPublicationRecordSnapshot(input: {
	record: EvidenceLibraryPublicationRecord;
	tags: readonly string[];
	baseUrl: string;
	extras?: PublicationRecordExtras;
}): PublicationRecordSnapshot {
	const inspected = inspectPublicationRecordSnapshot(input);
	if (inspected.issues.length) throw new Error(inspected.issues.join("; "));
	return parsePublicationRecordSnapshot(inspected.record);
}

export function inspectPublicationRecordSnapshot(input: {
	record: EvidenceLibraryPublicationRecord;
	tags: readonly string[];
	baseUrl: string;
	extras?: PublicationRecordExtras;
}): {
	issues: readonly string[];
	record: PublicationRecordSnapshot;
} {
	const issues: string[] = [];
	if (!input.record.title?.trim())
		issues.push("Add a title before activating publication");
	if (!input.record.date?.trim())
		issues.push("Add a publication date before activating publication");
	const licence = licenceComplete(input.record.licence) ? input.record.licence : null;
	if (!licence) issues.push("Pick this record's licence before activating publication");
	return {
		issues,
		record: {
			...publicationRecordMetadata(
				input.record,
				input.tags,
				licence,
				input.extras,
			),
			recordKey: input.record.key,
			canonicalRevision: input.record.revision,
			landingUrl: new URL(
				`/lib/${input.record.key}`,
				input.baseUrl,
			).toString(),
		},
	};
}

export function buildPublicationFileManifest(
	files: readonly EvidenceLibraryPublishedFile[],
): PublicationFileManifest {
	return parsePublicationFileManifest({
		files: files.map((file) => ({
			fileKey: file.itemKey,
			publicationRevision: file.revision,
			filename: file.filename,
			contentType: file.contentType,
			size: file.sizeBytes,
			sha256: file.sha256,
		})),
	});
}

export function buildPublicationIdentifiers(input: {
	bibliographicDoi?: string | null;
	managedCrossrefDoi?: string | null;
	zenodoVersionDoi?: string | null;
	zenodoConceptDoi?: string | null;
}): PublicationIdentifiers {
	return parsePublicationIdentifiers(
		Object.fromEntries(
			Object.entries(input).filter((entry): entry is [string, string] =>
				Boolean(entry[1]),
			),
		),
	);
}
