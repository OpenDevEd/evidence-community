import { NextRequest, NextResponse } from "next/server";
import { getItemRaw } from "../../route";
import { PDFDocument } from "pdf-lib";
import { fetchPublicFile } from "@/lib/public-fetch";
import { getLibraryConfig } from "@/config/library-config/server";
import { buildSiteUrl } from "@/lib/site-url";

async function modifyPDFMetadata(
	pdfUrl: string,
	title: string | null,
	maxBytes: number,
): Promise<Uint8Array | null> {
	try {
		const { data } = await fetchPublicFile(new URL(pdfUrl), {
			accept: "application/pdf",
			timeoutMs: 30_000,
			maxBytes,
		});
		const pdfDoc = await PDFDocument.load(data);
		pdfDoc.setTitle(title || "");
		return await pdfDoc.save();
	} catch (error) {
		console.error("Error modifying PDF metadata:", error);
		return null;
	}
}

export async function GET(
	request: NextRequest,
	props: { params: Promise<{ key: string; attachmentKey: string }> }
) {
	const { key: itemKey, attachmentKey } = await props.params;

	const config = await getLibraryConfig();
	const result = await getItemRaw(itemKey, config);

	if (!result.item) {
		return NextResponse.json(
			{ error: "Item not found" },
			{ status: 404 }
		);
	}

	if (!result.item.attachmentsData) {
		return NextResponse.json(
			{ error: "Item or attachments not found" },
			{ status: 404 }
		);
	}

	const attachment = result.item.attachmentsData.find(
		(a) => a.key === attachmentKey
	);

	if (!attachment || !attachment.url) {
		const itemPageUrl = new URL(`/lib/${itemKey}`, request.url);
		itemPageUrl.searchParams.set("error", "PDFNotFound");
		return NextResponse.redirect(itemPageUrl);
	}

	const isPDF = attachment.contentType?.toLowerCase().includes("pdf");

	if (isPDF) {
		const modifiedPdf = await modifyPDFMetadata(
			attachment.url,
			attachment.title,
			config.services.storage.maxPdfBytes,
		);

		if (modifiedPdf) {
			return new NextResponse(Buffer.from(modifiedPdf), {
				status: 200,
				headers: {
					"Content-Type": "application/pdf",
					"Content-Disposition": "inline;",
					// The record's page is the one search engines list; the file would otherwise count as a duplicate of it.
					Link: `<${buildSiteUrl(`/lib/${result.item.key}`, config.identity.baseUrl)}>; rel="canonical"`,
					"Item-Key": itemKey,
					"Attachment-Key": attachmentKey,
				},
			});
		}

		// PDF modification failed, fall back to original URL
		console.warn("PDF modification failed, falling back to original URL");
	}

	// For non-PDF attachments or failed PDF modification, redirect to source
	return NextResponse.redirect(attachment.url);
}
