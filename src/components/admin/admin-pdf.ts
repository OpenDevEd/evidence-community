import type { AdminAttachment, AdminItemDetail } from "@/lib/admin/types";
import {
	completeAdminPdf,
	sha256File,
	stageAdminPdf,
	uploadAdminPdf,
} from "./admin-api";

export type PdfUploadStep = "Preparing" | "Uploading" | "Processing";

/** A restoration draft is editable while its public record remains deleted. */
export function isUnrestoredRecord(detail: AdminItemDetail) {
	return detail.state === "deleted" && !detail.draft;
}

/** Use an existing PDF, then an empty attachment, before creating another one. */
export function documentAttachment(
	detail: AdminItemDetail,
	nativeOnly = false,
): AdminAttachment | AdminItemDetail | undefined {
	if (detail.itemType.toLowerCase() === "attachment") return detail;
	const available = detail.attachments.filter(
		(attachment) =>
			attachment.state !== "deleted" &&
			(!attachment.fileRemovalPending || nativeOnly) &&
			(!nativeOnly || attachment.sourceConnectionKey === "native"),
	);
	return (
		available.find(
			(attachment) =>
				attachment.sourceConnectionKey === "native" &&
				(attachment.fileDraft || attachment.filePublication),
		) ??
		available.find(
			(attachment) =>
				attachment.fileDraft ||
				attachment.filePublication ||
				attachment.sourceFileUrl,
		) ??
		available.find(
			(attachment) => attachment.sourceConnectionKey === "native",
		)
	);
}

export function validatePdf(file: File) {
	if (!file.name.toLowerCase().endsWith(".pdf")) {
		throw new Error("Choose a PDF file");
	}
	if (!file.size) throw new Error("The selected PDF is empty");
}

export async function uploadPdfFile(
	key: string,
	file: File,
	onProgress: (step: PdfUploadStep) => void,
) {
	validatePdf(file);
	onProgress("Preparing");
	const expectedSha256 = await sha256File(file);
	const staged = await stageAdminPdf(key, {
		expectedSha256,
		expectedSizeBytes: file.size,
		filename: file.name,
	});
	onProgress("Uploading");
	await uploadAdminPdf(staged.upload.signedUrl, file);
	onProgress("Processing");
	await completeAdminPdf(key, staged.fileDraft.uploadRevision);
}
