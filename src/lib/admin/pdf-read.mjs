// Plain JavaScript, so a worker thread can load it without a TypeScript loader.
import { createCanvas } from "@napi-rs/canvas";
import { join } from "node:path";

const COVER_WIDTH = 1600;

// pdf.js reads character maps (Chinese, Japanese, Korean and other composite fonts), the standard PDF fonts and its
// JBIG2 and JPEG 2000 decoders from these folders. Without them it loses text set in those fonts and leaves scanned
// images out of covers. Only its errors are logged: its font warnings ran to thousands an hour on a large import.
// Found from the app's folder: a bundler rewrites `require.resolve` into a module id, which is not a path.
const PDFJS_ROOT = join(process.cwd(), "node_modules", "pdfjs-dist");
export const PDFJS_OPTIONS = {
	cMapUrl: `${join(PDFJS_ROOT, "cmaps")}/`,
	standardFontDataUrl: `${join(PDFJS_ROOT, "standard_fonts")}/`,
	wasmUrl: `${join(PDFJS_ROOT, "wasm")}/`,
	iccUrl: `${join(PDFJS_ROOT, "iccs")}/`,
	verbosity: 0,
};

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
		cover: coverJpeg(canvas),
		coverHeight,
		coverWidth: COVER_WIDTH,
		pageCount: document.numPages,
		text: cleanExtractedText(pages.join("\n\n")),
	};
}

/**
 * The cover as a JPEG at quality 92. Encoding a PNG took about 30 ms of a
 * PDF's 120 even through sharp; this takes about 12, for a file about a
 * tenth larger.
 * @param {import("@napi-rs/canvas").Canvas} canvas
 */
function coverJpeg(canvas) {
	return new Uint8Array(canvas.toBuffer("image/jpeg", 92));
}

/**
 * Opens, reads and closes one document.
 * @param {Uint8Array} bytes
 */
export async function readPdfBytes(bytes) {
	const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const loadingTask = getDocument({ data: bytes, useSystemFonts: true, ...PDFJS_OPTIONS });
	try {
		return await readPdf(loadingTask);
	} finally {
		await loadingTask.destroy();
	}
}
