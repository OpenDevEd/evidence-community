import { createCanvas } from "@napi-rs/canvas";
import type { PDFDocumentLoadingTask } from "pdfjs-dist/legacy/build/pdf.mjs";

import { AdminValidationError } from "./errors";

const COVER_WIDTH = 1600;

type TextItem = {
	str: string;
	transform: number[];
};

export type ProcessedPdf = {
	cover: Uint8Array;
	coverHeight: number;
	coverWidth: number;
	pageCount: number;
	text: string;
};

export class InvalidPdfError extends AdminValidationError {
	constructor(message: string, options?: ErrorOptions) {
		super(message, { file: message }, options);
		this.name = "InvalidPdfError";
	}
}

function pageText(pageNumber: number, items: readonly TextItem[]) {
	let lastY: number | undefined;
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

function cleanExtractedText(text: string) {
	return text.replace(
		/[\u0000\uFFFD\uFFFE\uFFFF\u0001-\u0008\u000B-\u000C\u000E-\u001F]/gu,
		"",
	);
}

// pdf.js never finishes rendering a document when another document in the
// same process is destroyed meanwhile, so documents take turns. A turn ends
// after PROCESSING_TIMEOUT_MS, so one PDF cannot hold up the rest.
const PROCESSING_TIMEOUT_MS = 60_000;
let turn: Promise<unknown> = Promise.resolve();

export async function processPdf(bytes: Uint8Array): Promise<ProcessedPdf> {
	const headerOffset = Buffer.from(bytes).indexOf("%PDF-");
	if (headerOffset < 0 || headerOffset > 1024) {
		throw new InvalidPdfError("Choose a valid PDF file.");
	}
	const run = turn.then(() => processInTurn(bytes));
	turn = run.catch(() => undefined);
	return run;
}

async function processInTurn(bytes: Uint8Array): Promise<ProcessedPdf> {
	const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const loadingTask = getDocument({
		data: bytes.slice(),
		useSystemFonts: true,
	});
	// The turn includes destroying the document, which must finish before the next one starts.
	const work = (async () => {
		try {
			return await readPdf(loadingTask);
		} finally {
			await loadingTask.destroy();
		}
	})();
	let timer: NodeJS.Timeout | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			// The next document waits for this one to be destroyed, since the
			// overlap is what hangs pdf.js, but only for so long: a document
			// that ran out of time may never finish destroying either.
			const destroyed = loadingTask.destroy().catch(() => undefined);
			const given = new Promise((resolve) => setTimeout(resolve, PROCESSING_TIMEOUT_MS));
			void Promise.race([destroyed, given]).then(() =>
				reject(
					new InvalidPdfError(
						"This PDF took too long to process. Try exporting it again or choose another file.",
					),
				),
			);
		}, PROCESSING_TIMEOUT_MS);
	});

	try {
		return await Promise.race([work, deadline]);
	} catch (error) {
		if (error instanceof InvalidPdfError) throw error;
		console.error("PDF processing failed", error);
		throw new InvalidPdfError(
			"This PDF could not be processed. Try exporting it again or choose another file.",
			{ cause: error },
		);
	} finally {
		clearTimeout(timer);
	}
}

async function readPdf(loadingTask: PDFDocumentLoadingTask): Promise<ProcessedPdf> {
	const document = await loadingTask.promise;
	if (document.numPages < 1) {
		throw new InvalidPdfError("This PDF has no pages.");
	}

	const pages: string[] = [];
	let firstPage: Awaited<ReturnType<typeof document.getPage>> | undefined;
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
		throw new InvalidPdfError("This PDF has no readable pages.");
	}
	const naturalViewport = firstPage.getViewport({ scale: 1 });
	const scale = COVER_WIDTH / naturalViewport.width;
	const viewport = firstPage.getViewport({ scale });
	const coverHeight = Math.max(1, Math.round(viewport.height));
	const canvas = createCanvas(COVER_WIDTH, coverHeight);
	await firstPage.render({
		canvas: canvas as unknown as HTMLCanvasElement,
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
