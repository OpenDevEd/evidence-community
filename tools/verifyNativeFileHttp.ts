import { createHash } from "node:crypto";

import {
	itemDraft,
	itemFileDraft,
	itemIdentity,
	outbox,
} from "@opendeved/evidence-library-core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { itemFilePublication } from "../src/db/schema/source";
import { adminItemListProjection } from "../src/db/schema/tables/adminItemListProjection";
import { item } from "../src/db/schema/tables/item";
import { itemToCollection } from "../src/db/schema/tables/itemToCollection";
import { itemToTag } from "../src/db/schema/tables/itemToTag";

const baseUrl = process.env.EVIDENCE_LIBRARY_TEST_URL;
const databaseUrl = process.env.DATABASE_URL_POST;
const storageUrl = process.env.SUPABASE_TEST_URL;
const publishableKey = process.env.SUPABASE_TEST_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const injectedFailure = process.env.NATIVE_FILE_HTTP_INJECT_FAILURE;
const privateBucket =
	process.env.SUPABASE_TEST_PRIVATE_BUCKET ?? "evidence-library-private";
const publicBucket =
	process.env.SUPABASE_TEST_PUBLIC_BUCKET ?? "evidence-library-public";

if (
	!baseUrl ||
	!databaseUrl ||
	!storageUrl ||
	!publishableKey ||
	!serviceRoleKey
) {
	throw new Error(
		"DATABASE_URL_POST, EVIDENCE_LIBRARY_TEST_URL, SUPABASE_TEST_URL, SUPABASE_TEST_PUBLISHABLE_KEY, and SUPABASE_TEST_SERVICE_ROLE_KEY are required",
	);
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

assert(
	!injectedFailure ||
		injectedFailure === "after-upload" ||
		injectedFailure === "after-publish",
	"NATIVE_FILE_HTTP_INJECT_FAILURE must be after-upload or after-publish",
);

function publicObjectPath(publicUrl: string) {
	const prefix = `/storage/v1/object/public/${publicBucket}/`;
	const pathname = new URL(publicUrl).pathname;
	assert(
		pathname.startsWith(prefix),
		`Published file URL did not use the expected bucket: ${publicUrl}`,
	);
	return decodeURIComponent(pathname.slice(prefix.length));
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

async function assertIndexingReceipts(
	db: ReturnType<typeof createPostgresDatabaseResource>["database"],
	response: {
		indexingReceipts?: Array<{
			entityKey: string;
			entityType: "collection" | "item";
			revision: number;
		}>;
	},
	expectedKeys: string[],
	context: string,
) {
	const receipts = response.indexingReceipts ?? [];
	assert(
		receipts.length === expectedKeys.length &&
			expectedKeys.every((key) =>
				receipts.some(
					(receipt) =>
						receipt.entityType === "item" &&
						receipt.entityKey === key,
				),
			),
		`${context} returned an incomplete receipt set: ${JSON.stringify(receipts)}`,
	);
	const rows = await db
		.select({
			entityKey: outbox.entityKey,
			entityType: outbox.entityType,
			revision: outbox.revision,
		})
		.from(outbox)
		.where(
			or(
				...receipts.map((receipt) =>
					and(
						eq(outbox.entityType, receipt.entityType),
						eq(outbox.entityKey, receipt.entityKey),
						eq(outbox.revision, receipt.revision),
					),
				),
			),
		);
	assert(
		rows.length === receipts.length,
		`${context} returned receipts that do not match its outbox rows`,
	);
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

async function removeAndVerifyObjects(
	storage: SupabaseClient,
	bucket: string,
	paths: Set<string>,
) {
	if (paths.size === 0) return;
	const objectPaths = [...paths];
	let lastError: unknown = null;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const { error: removalError } = await storage.storage
				.from(bucket)
				.remove(objectPaths);
			if (removalError) throw removalError;
			for (const path of objectPaths) {
				const segments = path.split("/");
				const filename = segments.pop()!;
				const directory = segments.join("/");
				const { data: remaining, error } = await storage.storage
					.from(bucket)
					.list(directory, { limit: 100, search: filename });
				if (error) throw error;
				assert(
					!remaining.some(({ name }) => name === filename),
					`Verification object survived cleanup: ${bucket}/${path}`,
				);
			}
			return;
		} catch (error) {
			lastError = error;
			if (attempt < 2) {
				await new Promise((resolve) =>
					setTimeout(resolve, 50 * 2 ** attempt),
				);
			}
		}
	}
	throw lastError;
}

async function verify() {
	const database = createPostgresDatabaseResource(databaseUrl!);
	const db = database.database;
	const storageAdmin = createClient(storageUrl!, serviceRoleKey!, {
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false,
		},
	});
	const itemKeys: string[] = [];
	const privateObjectPaths = new Set<string>();
	const publicObjectPaths = new Set<string>();
	const runMarker = createHash("sha256")
		.update(`${process.pid}-${Date.now()}`)
		.digest("hex")
		.slice(0, 12);
	const parentTitle = `HTTP parent ${runMarker}`;
	const attachmentTitle = `HTTP attachment ${runMarker}`;
	const fixtureTitles = [parentTitle, attachmentTitle];
	const recordDraftObjectPaths = async (itemKey: string) => {
		const [fileDraft] = await db
			.select({
				coverObjectPath: itemFileDraft.coverObjectPath,
				objectPath: itemFileDraft.objectPath,
			})
			.from(itemFileDraft)
			.where(eq(itemFileDraft.itemKey, itemKey));
		if (fileDraft) {
			privateObjectPaths.add(fileDraft.objectPath);
			if (fileDraft.coverObjectPath) {
				privateObjectPaths.add(fileDraft.coverObjectPath);
			}
		}
	};

	try {
		const parent = await jsonRequest(
			"/api/admin/items/drafts",
			{
				method: "POST",
				body: JSON.stringify({
					itemType: "Report",
					title: parentTitle,
				}),
			},
			201,
		);
		const parentKey = parent.draft.itemKey as string;
		itemKeys.push(parentKey);
		const attachment = await jsonRequest(
			"/api/admin/items/drafts",
			{
				method: "POST",
				body: JSON.stringify({
					itemType: "Attachment",
					parentItem: parentKey,
					title: attachmentTitle,
				}),
			},
			201,
		);
		const attachmentKey = attachment.draft.itemKey as string;
		itemKeys.push(attachmentKey);

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
		privateObjectPaths.add(staged.upload.path);
		const storage = createClient(storageUrl!, publishableKey!, {
			auth: {
				autoRefreshToken: false,
				detectSessionInUrl: false,
				persistSession: false,
			},
		});
		await uploadSignedPdf(storage, staged.upload, pdf);
		if (injectedFailure === "after-upload") {
			throw new Error("Injected failure after signed upload");
		}

		const uploadRevision = staged.fileDraft.uploadRevision as number;
		await jsonRequest(`/api/admin/items/${attachmentKey}/file/complete`, {
			method: "POST",
			body: JSON.stringify({
				expectedUploadRevision: uploadRevision,
			}),
		});
		await recordDraftObjectPaths(attachmentKey);
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
		await assertIndexingReceipts(
			db,
			publication,
			[attachmentKey, parentKey],
			"PDF publication",
		);
		publicObjectPaths.add(publicObjectPath(publication.file.publicUrl));
		publicObjectPaths.add(
			publicObjectPath(publication.file.coverPublicUrl),
		);
		if (injectedFailure === "after-publish") {
			throw new Error("Injected failure after public file publication");
		}
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
		privateObjectPaths.add(disposableStage.upload.path);
		await uploadSignedPdf(storage, disposableStage.upload, pdf);
		await jsonRequest(`/api/admin/items/${attachmentKey}/file/complete`, {
			method: "POST",
			body: JSON.stringify({
				expectedUploadRevision:
					disposableStage.fileDraft.uploadRevision,
			}),
		});
		await recordDraftObjectPaths(attachmentKey);
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

		const fileUnpublished = await jsonRequest(
			`/api/admin/items/${attachmentKey}/file`,
			{
			method: "DELETE",
			},
		);
		await assertIndexingReceipts(
			db,
			fileUnpublished,
			[attachmentKey, parentKey],
			"PDF unpublish",
		);
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
				runMarker,
			}),
		);
	} finally {
		try {
			const [publishedFixtures, draftFixtures] = await Promise.all([
				db
					.select({ key: item.key })
					.from(item)
					.where(inArray(item.title, fixtureTitles)),
				db
					.select({ key: itemDraft.itemKey })
					.from(itemDraft)
					.where(
						or(
								sql`${itemDraft.patch}->>'title' = ${parentTitle}`,
								sql`${itemDraft.patch}->>'title' = ${attachmentTitle}`,
						),
					),
			]);
			const cleanupKeys = [
				...new Set([
					...itemKeys,
					...publishedFixtures.map(({ key }) => key),
					...draftFixtures.map(({ key }) => key),
				]),
			];

			if (cleanupKeys.length > 0) {
				const [fileDrafts, filePublications] = await Promise.all([
					db
						.select({
							coverObjectPath: itemFileDraft.coverObjectPath,
							objectPath: itemFileDraft.objectPath,
						})
						.from(itemFileDraft)
						.where(inArray(itemFileDraft.itemKey, cleanupKeys)),
					db
						.select({
							coverObjectPath:
								itemFilePublication.coverObjectPath,
							objectPath: itemFilePublication.objectPath,
							sourceCoverObjectPath:
								itemFilePublication.sourceCoverObjectPath,
							sourceObjectPath:
								itemFilePublication.sourceObjectPath,
						})
						.from(itemFilePublication)
						.where(
							inArray(itemFilePublication.itemKey, cleanupKeys),
						),
				]);
				for (const fileDraft of fileDrafts) {
					privateObjectPaths.add(fileDraft.objectPath);
					if (fileDraft.coverObjectPath) {
						privateObjectPaths.add(fileDraft.coverObjectPath);
					}
				}
				for (const publication of filePublications) {
					privateObjectPaths.add(publication.sourceObjectPath);
					privateObjectPaths.add(publication.sourceCoverObjectPath);
					publicObjectPaths.add(publication.objectPath);
					publicObjectPaths.add(publication.coverObjectPath);
				}

				await Promise.all([
					removeAndVerifyObjects(
						storageAdmin,
						privateBucket,
						privateObjectPaths,
					),
					removeAndVerifyObjects(
						storageAdmin,
						publicBucket,
						publicObjectPaths,
					),
				]);

				await db.transaction(async (transaction) => {
					await transaction
						.delete(outbox)
						.where(
							and(
								eq(outbox.entityType, "item"),
								inArray(outbox.entityKey, cleanupKeys),
							),
						);
					await transaction
						.delete(itemToCollection)
						.where(inArray(itemToCollection.itemKey, cleanupKeys));
					await transaction
						.delete(itemToTag)
						.where(inArray(itemToTag.itemKey, cleanupKeys));
					await transaction
						.delete(itemFilePublication)
						.where(
							inArray(itemFilePublication.itemKey, cleanupKeys),
						);
					await transaction
						.delete(itemFileDraft)
						.where(inArray(itemFileDraft.itemKey, cleanupKeys));
					await transaction
						.delete(adminItemListProjection)
						.where(
							inArray(adminItemListProjection.key, cleanupKeys),
						);
					await transaction
						.delete(item)
						.where(inArray(item.key, cleanupKeys));
					await transaction
						.delete(itemDraft)
						.where(inArray(itemDraft.itemKey, cleanupKeys));
					await transaction
						.delete(itemIdentity)
						.where(
							and(
								eq(itemIdentity.sourceConnectionKey, "native"),
								inArray(itemIdentity.key, cleanupKeys),
							),
						);
				});

				const databaseResidue = await Promise.all([
					db
						.select({ key: itemIdentity.key })
						.from(itemIdentity)
						.where(inArray(itemIdentity.key, cleanupKeys)),
					db
						.select({ key: item.key })
						.from(item)
						.where(inArray(item.key, cleanupKeys)),
					db
						.select({ key: itemDraft.itemKey })
						.from(itemDraft)
						.where(inArray(itemDraft.itemKey, cleanupKeys)),
					db
						.select({ key: itemFileDraft.itemKey })
						.from(itemFileDraft)
						.where(inArray(itemFileDraft.itemKey, cleanupKeys)),
					db
						.select({ key: itemFilePublication.itemKey })
						.from(itemFilePublication)
						.where(
							inArray(itemFilePublication.itemKey, cleanupKeys),
						),
					db
						.select({ key: outbox.entityKey })
						.from(outbox)
						.where(
							and(
								eq(outbox.entityType, "item"),
								inArray(outbox.entityKey, cleanupKeys),
							),
						),
					db
						.select({ key: itemToCollection.itemKey })
						.from(itemToCollection)
						.where(inArray(itemToCollection.itemKey, cleanupKeys)),
					db
						.select({ key: itemToTag.itemKey })
						.from(itemToTag)
						.where(inArray(itemToTag.itemKey, cleanupKeys)),
					db
						.select({ key: adminItemListProjection.key })
						.from(adminItemListProjection)
						.where(
							inArray(adminItemListProjection.key, cleanupKeys),
						),
				]);
				assert(
					databaseResidue.every((rows) => rows.length === 0),
					`HTTP file verification cleanup left database residue: ${JSON.stringify(databaseResidue)}`,
				);
			}
		} finally {
			await database.dispose();
		}
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
