import { createCanvas } from "@napi-rs/canvas";

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

export async function processPdf(bytes: Uint8Array): Promise<ProcessedPdf> {
	const headerOffset = Buffer.from(bytes).indexOf("%PDF-");
	if (headerOffset < 0 || headerOffset > 1024) {
		throw new InvalidPdfError("Choose a valid PDF file.");
	}

	const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const loadingTask = getDocument({
		data: bytes.slice(),
		useSystemFonts: true,
	});

	try {
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
	} catch (error) {
		if (error instanceof InvalidPdfError) throw error;
		console.error("PDF processing failed", error);
		throw new InvalidPdfError(
			"This PDF could not be processed. Try exporting it again or choose another file.",
			{ cause: error },
		);
	} finally {
		await loadingTask.destroy();
	}
}
