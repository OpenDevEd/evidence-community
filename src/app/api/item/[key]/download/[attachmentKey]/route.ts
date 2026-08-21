import { NextRequest, NextResponse } from "next/server";
import { getItemRaw } from "../../route";
import { PDFDocument } from "pdf-lib";
import { isVisiblePdfAttachment } from "@/lib/attachment-visibility";
import { getRequestOrigin } from "@/lib/site-url";

function singleVisiblePdf<T extends Parameters<typeof isVisiblePdfAttachment>[0]>(
	attachments: T[],
) {
	const visible = attachments.filter(isVisiblePdfAttachment);
	return visible.length === 1 ? visible[0] : undefined;
}

async function modifyPDFMetadata(
	pdfUrl: string,
	title: string | null
): Promise<Uint8Array | null> {
	try {
		const pdfResponse = await fetch(pdfUrl);

		if (!pdfResponse.ok) {
			console.error(`Failed to fetch PDF: ${pdfResponse.statusText}`);
			return null;
		}

		const pdfBuffer = await pdfResponse.arrayBuffer();
		const pdfDoc = await PDFDocument.load(pdfBuffer);
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

	const result = await getItemRaw(itemKey);

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

	const attachment =
		result.item.attachmentsData.find((a) => a.key === attachmentKey) ??
		// AI citations occasionally carry a stale or invented attachment key.
		// When the publication has exactly one visible PDF there is no
		// ambiguity about what was meant, so serve it instead of failing.
		singleVisiblePdf(result.item.attachmentsData);

	if (!attachment || !attachment.url) {
		const itemPageUrl = new URL(`/lib/${itemKey}`, getRequestOrigin(request));
		itemPageUrl.searchParams.set("error", "PDFNotFound");
		return NextResponse.redirect(itemPageUrl);
	}

	const isPDF = attachment.contentType?.toLowerCase().includes("pdf");

	if (isPDF) {
		const modifiedPdf = await modifyPDFMetadata(
			attachment.url,
			attachment.title
		);

		if (modifiedPdf) {
			return new NextResponse(Buffer.from(modifiedPdf), {
				status: 200,
				headers: {
					"Content-Type": "application/pdf",
					"Content-Disposition": "inline;",
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
