import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { createSupabaseFileStorage } from "../src/lib/admin/file-storage";

const url = process.env.SUPABASE_TEST_URL;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const publishableKey = process.env.SUPABASE_TEST_PUBLISHABLE_KEY;

if (!url || !serviceRoleKey || !publishableKey) {
	throw new Error(
		"SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_ROLE_KEY, and SUPABASE_TEST_PUBLISHABLE_KEY are required",
	);
}

const suffix = createHash("sha256")
	.update(`${process.pid}-${Date.now()}`)
	.digest("hex")
	.slice(0, 12);
const privateBucket = `file-private-${suffix}`;
const publicBucket = `file-public-${suffix}`;
const pdfPath = "native/ABCDEFGH/1/file.pdf";
const coverPath = "native/ABCDEFGH/1/cover.png";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function createPdf() {
	const document = await PDFDocument.create();
	const font = await document.embedFont(StandardFonts.Helvetica);
	const page = document.addPage([300, 400]);
	page.drawText("Supabase Storage verification", {
		x: 30,
		y: 340,
		size: 18,
		font,
	});
	return new Uint8Array(await document.save());
}

async function verify() {
	const admin = createClient(url!, serviceRoleKey!, {
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false,
		},
	});
	const uploader = createClient(url!, publishableKey!, {
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false,
		},
	});
	const storage = createSupabaseFileStorage({
		url: url!,
		serviceRoleKey: serviceRoleKey!,
		privateBucket,
		publicBucket,
		maxPdfBytes: 10_000_000,
	});

	try {
		for (const [name, isPublic] of [
			[privateBucket, false],
			[publicBucket, true],
		] as const) {
			const { error } = await admin.storage.createBucket(name, {
				allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png"],
				fileSizeLimit: 10_000_000,
				public: isPublic,
			});
			if (error) throw error;
		}

		const pdf = await createPdf();
		const signed = await storage.createSignedUpload(pdfPath);
		const { error: uploadError } = await uploader.storage
			.from(privateBucket)
			.uploadToSignedUrl(signed.path, signed.token, pdf, {
				contentType: "application/pdf",
			});
		if (uploadError) throw uploadError;

		const privatePdf = await storage.downloadPrivate(pdfPath);
		assert(
			Buffer.from(privatePdf).equals(Buffer.from(pdf)),
			"Signed private upload did not round-trip",
		);

		const cover = new Uint8Array([
			137, 80, 78, 71, 13, 10, 26, 10,
		]);
		await storage.uploadPrivate(coverPath, cover, "image/png");
		await Promise.all([
			storage.uploadPublic(
				pdfPath,
				privatePdf,
				"application/pdf",
			),
			storage.uploadPublic(coverPath, cover, "image/png"),
		]);

		const response = await fetch(storage.publicUrl(pdfPath));
		assert(response.ok, `Public PDF returned HTTP ${response.status}`);
		assert(
			Buffer.from(await response.arrayBuffer()).equals(
				Buffer.from(pdf),
			),
			"Public PDF bytes did not match the upload",
		);

		await Promise.all([
			storage.removePrivate([pdfPath, coverPath]),
			storage.removePublic([pdfPath, coverPath]),
		]);
		const removedResponse = await fetch(
			`${storage.publicUrl(pdfPath)}?removed=${Date.now()}`,
			{ cache: "no-store" },
		);
		assert(
			!removedResponse.ok,
			`Removed public PDF remained available (HTTP ${removedResponse.status})`,
		);

		console.log(
			JSON.stringify({
				privateBucket,
				publicBucket,
				signedUpload: true,
				publicRoundTrip: true,
				publicRemoval: true,
			}),
		);
	} finally {
		await Promise.allSettled([
			admin.storage.emptyBucket(privateBucket),
			admin.storage.emptyBucket(publicBucket),
		]);
		await Promise.allSettled([
			admin.storage.deleteBucket(privateBucket),
			admin.storage.deleteBucket(publicBucket),
		]);
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
