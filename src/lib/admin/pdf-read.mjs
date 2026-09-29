// Plain JavaScript, so a worker thread can load it without a TypeScript loader.
import { createCanvas } from "@napi-rs/canvas";

const COVER_WIDTH = 1600;

/** A PDF that opened but cannot be published. The message is shown to the user. */
export const INVALID_PDF_CONTENT = "InvalidPdfContent";

/** @param {string} message */
function invalid(message) {
	return Object.assign(new Error(message), { name: INVALID_PDF_CONTENT });
}

/**
 * @param {number} pageNumber
 * @param {readonly { str: string; transform: number[] }[]} items
 */
function pageText(pageNumber, items) {
	/** @type {number | undefined} */
	let lastY;
	let text = "";

	for (const item of items) {
		const y = item.transform[5];
		if (text.length > 0 && lastY !== undefined && y !== lastY) {
			text += "\n";
		}
		text += item.str;
		lastY = y;
	}

	return `**|| PAGE ${pageNumber} ||**\n\n${text}`;
}

/** @param {string} text */
function cleanExtractedText(text) {
	return text.replace(
		/[\u0000�￾￿\u0001-\u0008\u000B-\u000C\u000E-\u001F]/gu,
		"",
	);
}

/**
 * @param {import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentLoadingTask} loadingTask
 * @returns {Promise<{ cover: Uint8Array; coverHeight: number; coverWidth: number; pageCount: number; text: string }>}
 */
export async function readPdf(loadingTask) {
	const document = await loadingTask.promise;
	if (document.numPages < 1) {
		throw invalid("This PDF has no pages.");
	}

	/** @type {string[]} */
	const pages = [];
	/** @type {Awaited<ReturnType<typeof document.getPage>> | undefined} */
	let firstPage;
	for (
		let pageNumber = 1;
		pageNumber <= document.numPages;
		pageNumber++
	) {
		const page = await document.getPage(pageNumber);
		if (pageNumber === 1) firstPage = page;
		const content = await page.getTextContent();
		const items = content.items.flatMap((item) =>
			"str" in item && "transform" in item
				? [
						{
							str: item.str,
							transform: item.transform,
						},
					]
				: [],
		);
		pages.push(pageText(pageNumber, items));
		if (pageNumber !== 1) page.cleanup();
	}

	if (!firstPage) {
		throw invalid("This PDF has no readable pages.");
	}
	const naturalViewport = firstPage.getViewport({ scale: 1 });
	const scale = COVER_WIDTH / naturalViewport.width;
	const viewport = firstPage.getViewport({ scale });
	const coverHeight = Math.max(1, Math.round(viewport.height));
	const canvas = createCanvas(COVER_WIDTH, coverHeight);
	await firstPage.render({
		canvas: /** @type {any} */ (canvas),
		viewport,
	}).promise;
	firstPage.cleanup();

	return {
		cover: new Uint8Array(canvas.toBuffer("image/png")),
		coverHeight,
		coverWidth: COVER_WIDTH,
		pageCount: document.numPages,
		text: cleanExtractedText(pages.join("\n\n")),
	};
}

/**
 * Opens, reads and closes one document.
 * @param {Uint8Array} bytes
 */
export async function readPdfBytes(bytes) {
	const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const loadingTask = getDocument({ data: bytes, useSystemFonts: true });
	try {
		return await readPdf(loadingTask);
	} finally {
		await loadingTask.destroy();
	}
}
