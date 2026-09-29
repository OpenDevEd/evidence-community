import type { PDFDocumentLoadingTask } from "pdfjs-dist/legacy/build/pdf.mjs";

import { AdminValidationError } from "./errors";
import { INVALID_PDF_CONTENT, readPdf } from "./pdf-read.mjs";

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

// pdf.js never finishes rendering a document when another document in the
// same process is destroyed meanwhile, so documents take turns. A turn ends
// after PROCESSING_TIMEOUT_MS, so one PDF cannot hold up the rest.
const PROCESSING_TIMEOUT_MS = 60_000;
let turn: Promise<unknown> = Promise.resolve();

export function assertPdfHeader(bytes: Uint8Array) {
	const headerOffset = Buffer.from(bytes).indexOf("%PDF-");
	if (headerOffset < 0 || headerOffset > 1024) {
		throw new InvalidPdfError("Choose a valid PDF file.");
	}
}

/** The error a failed read becomes, whether it ran here or in a worker. */
export function pdfReadError(error: { name?: string; message: string }, cause?: unknown) {
	if (error.name === INVALID_PDF_CONTENT) return new InvalidPdfError(error.message, { cause });
	return new InvalidPdfError(
		"This PDF could not be processed. Try exporting it again or choose another file.",
		{ cause },
	);
}

export async function processPdf(bytes: Uint8Array): Promise<ProcessedPdf> {
	assertPdfHeader(bytes);
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
			const given = new Promise((resolve) => setTimeout(resolve, PROCESSING_TIMEOUT_MS).unref());
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
		if (!(error instanceof Error) || error.name !== INVALID_PDF_CONTENT) console.error("PDF processing failed", error);
		throw pdfReadError(error instanceof Error ? error : { message: String(error) }, error);
	} finally {
		clearTimeout(timer);
	}
}
