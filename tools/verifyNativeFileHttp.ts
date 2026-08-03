import { createHash } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";

const baseUrl = process.env.EVIDENCE_LIBRARY_TEST_URL;
const storageUrl = process.env.SUPABASE_TEST_URL;
const publishableKey = process.env.SUPABASE_TEST_PUBLISHABLE_KEY;
const privateBucket =
	process.env.SUPABASE_TEST_PRIVATE_BUCKET ??
	"evidence-library-private";

if (!baseUrl || !storageUrl || !publishableKey) {
	throw new Error(
		"EVIDENCE_LIBRARY_TEST_URL, SUPABASE_TEST_URL, and SUPABASE_TEST_PUBLISHABLE_KEY are required",
	);
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function jsonRequest(
	path: string,
	init: RequestInit = {},
	expectedStatus = 200,
) {
	const response = await fetch(`${baseUrl}${path}`, {
		...init,
		headers: {
			"Content-Type": "application/json",
			...init.headers,
		},
	});
	const body = await response.json().catch(() => null);
	if (response.status !== expectedStatus) {
		throw new Error(
			`${init.method ?? "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`,
		);
	}
	assert(
		response.headers.get("cache-control")?.includes("private") &&
			response.headers.get("cache-control")?.includes("no-store"),
		`${path} did not return private no-store headers`,
	);
	return body;
}

async function createPdf() {
	const document = await PDFDocument.create();
	const font = await document.embedFont(StandardFonts.Helvetica);
	const page = document.addPage([612, 792]);
	page.drawText("HTTP file lifecycle", {
		x: 72,
		y: 700,
		size: 24,
		font,
	});
	return new Uint8Array(await document.save());
}

async function uploadSignedPdf(
	storage: SupabaseClient,
	upload: { path: string; token: string },
	pdf: Uint8Array,
) {
	const { error } = await storage.storage
		.from(privateBucket)
		.uploadToSignedUrl(upload.path, upload.token, pdf, {
			contentType: "application/pdf",
		});
	if (error) throw error;
}

async function verify() {
	const parent = await jsonRequest(
		"/api/admin/items/drafts",
		{
			method: "POST",
			body: JSON.stringify({
				itemType: "Report",
				title: "HTTP parent",
			}),
		},
		201,
	);
	const parentKey = parent.draft.itemKey as string;
	const attachment = await jsonRequest(
		"/api/admin/items/drafts",
		{
			method: "POST",
			body: JSON.stringify({
				itemType: "Attachment",
				parentItem: parentKey,
				title: "HTTP attachment",
			}),
		},
		201,
	);
	const attachmentKey = attachment.draft.itemKey as string;

	const pdf = await createPdf();
	const sha256 = createHash("sha256").update(pdf).digest("hex");
	const staged = await jsonRequest(
		`/api/admin/items/${attachmentKey}/file`,
		{
			method: "POST",
			body: JSON.stringify({
				expectedSha256: sha256,
				expectedSizeBytes: pdf.byteLength,
				filename: "http-evidence.pdf",
			}),
		},
		201,
	);
	const storage = createClient(storageUrl!, publishableKey!, {
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false,
		},
	});
	await uploadSignedPdf(storage, staged.upload, pdf);

	const uploadRevision = staged.fileDraft.uploadRevision as number;
	await jsonRequest(
		`/api/admin/items/${attachmentKey}/file/complete`,
		{
			method: "POST",
			body: JSON.stringify({
				expectedUploadRevision: uploadRevision,
			}),
		},
	);
	await jsonRequest(`/api/admin/items/${parentKey}/publish`, {
		method: "POST",
		body: "{}",
	});
	await jsonRequest(`/api/admin/items/${attachmentKey}/publish`, {
		method: "POST",
		body: "{}",
	});
	const publication = await jsonRequest(
		`/api/admin/items/${attachmentKey}/file/publish`,
		{
			method: "POST",
			body: JSON.stringify({
				expectedUploadRevision: uploadRevision,
			}),
		},
	);
	const publicResponse = await fetch(publication.file.publicUrl);
	assert(publicResponse.ok, "Published PDF URL is not readable");
	assert(
		Buffer.from(await publicResponse.arrayBuffer()).equals(
			Buffer.from(pdf),
		),
		"Published PDF URL returned the wrong bytes",
	);

	const fileState = await jsonRequest(
		`/api/admin/items/${attachmentKey}/file`,
	);
	assert(
		fileState.file.draft === null &&
			fileState.file.publication.sha256 === sha256,
		"HTTP file state did not expose the publication",
	);
	const disposableStage = await jsonRequest(
		`/api/admin/items/${attachmentKey}/file`,
		{
			method: "POST",
			body: JSON.stringify({
				expectedSha256: sha256,
				expectedSizeBytes: pdf.byteLength,
				filename: "discarded-replacement.pdf",
			}),
		},
		201,
	);
	await uploadSignedPdf(storage, disposableStage.upload, pdf);
	await jsonRequest(
		`/api/admin/items/${attachmentKey}/file/complete`,
		{
			method: "POST",
			body: JSON.stringify({
				expectedUploadRevision:
					disposableStage.fileDraft.uploadRevision,
			}),
		},
	);
	await jsonRequest(
		`/api/admin/items/${attachmentKey}/file/draft`,
		{ method: "DELETE" },
		204,
	);
	const stateAfterDiscard = await jsonRequest(
		`/api/admin/items/${attachmentKey}/file`,
	);
	assert(
		stateAfterDiscard.file.draft === null &&
			stateAfterDiscard.file.publication.sha256 === sha256,
		"HTTP staged-file discard changed the publication",
	);

	await jsonRequest(`/api/admin/items/${attachmentKey}/file`, {
		method: "DELETE",
	});
	const removedResponse = await fetch(
		`${publication.file.publicUrl}?removed=${Date.now()}`,
		{ cache: "no-store" },
	);
	assert(!removedResponse.ok, "HTTP file unpublish left the PDF public");
	await jsonRequest(`/api/admin/items/${attachmentKey}/unpublish`, {
		method: "POST",
		body: "{}",
	});

	console.log(
		JSON.stringify({
			parentKey,
			attachmentKey,
			signedUpload: true,
			metadataPublishedSeparately: true,
			filePublishedSeparately: true,
			stagedReplacementDiscarded: true,
			fileUnpublished: true,
		}),
	);
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
