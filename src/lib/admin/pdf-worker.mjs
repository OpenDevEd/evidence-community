// Reads PDFs for the pool in pdf-pool.ts. pdf.js hangs when one document is
// destroyed while another renders, so each worker reads one at a time.
import { parentPort } from "node:worker_threads";

import { INVALID_PDF_CONTENT, readPdfBytes } from "./pdf-read.mjs";

let turn = Promise.resolve();

parentPort?.on("message", (/** @type {{ id: number; bytes: Uint8Array }} */ { id, bytes }) => {
	turn = turn.then(async () => {
		try {
			const result = await readPdfBytes(bytes);
			parentPort?.postMessage({ id, result }, [result.cover.buffer]);
		} catch (error) {
			parentPort?.postMessage({
				id,
				error: {
					invalid: error instanceof Error && error.name === INVALID_PDF_CONTENT,
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	});
});
