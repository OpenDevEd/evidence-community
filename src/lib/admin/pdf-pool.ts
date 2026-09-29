import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

import { assertPdfHeader, InvalidPdfError, pdfReadError, type ProcessedPdf } from "./pdf-processing";

// Imports read PDFs in worker threads, so several are read at once on other
// cores. Each worker reads one PDF at a time; one that runs out of time,
// fails or exits is retired and a new one takes the next PDF, which also
// ends a hung pdf.js.
const MAX_WORKERS = 4;
const PROCESSING_TIMEOUT_MS = 60_000;

type Reply = { result?: ProcessedPdf; error?: { invalid: boolean; name: string; message: string; stack?: string } };
type Job = { bytes: Uint8Array; resolve: (result: ProcessedPdf) => void; reject: (error: Error) => void };
type Slot = { worker: Worker; job: Job | null; timer?: NodeJS.Timeout };

const slots: Slot[] = [];
const waiting: Job[] = [];

const poolSize = () => Math.min(MAX_WORKERS, Math.max(1, availableParallelism() - 1));

/** Starts a worker that stays handled for its whole life, busy or idle. */
function startSlot(): Slot {
	const slot: Slot = { worker: new Worker(new URL("./pdf-worker.mjs", import.meta.url)), job: null };
	slot.worker.unref();
	slot.worker.on("message", ({ result, error }: Reply) => {
		const job = detach(slot);
		if (result) job?.resolve(result);
		else job?.reject(workerError(error));
		drain();
	});
	slot.worker.on("error", (error) => retire(slot, error));
	slot.worker.on("exit", () => retire(slot, new Error("PDF worker exited")));
	slots.push(slot);
	return slot;
}

/** A worker's failure as the caller sees it; one that is not about the PDF's content is logged, as in this thread. */
function workerError(error: Reply["error"]) {
	const cause = Object.assign(new Error(error?.message ?? "PDF worker failed"), { name: error?.name ?? "Error", stack: error?.stack });
	if (!error?.invalid) console.error("PDF processing failed", cause);
	return pdfReadError({ name: error?.invalid ? "InvalidPdfContent" : "Error", message: cause.message }, cause);
}

function detach(slot: Slot) {
	clearTimeout(slot.timer);
	const job = slot.job;
	slot.job = null;
	slot.worker.unref();
	return job;
}

/** Takes a worker out of the pool; the PDF it held, if any, fails. */
function retire(slot: Slot, cause: unknown) {
	const index = slots.indexOf(slot);
	if (index < 0) return;
	slots.splice(index, 1);
	detach(slot)?.reject(cause instanceof InvalidPdfError ? cause : pdfReadError({ message: String(cause) }, cause));
	void slot.worker.terminate();
	drain();
}

function assign(slot: Slot, job: Job) {
	slot.job = job;
	slot.worker.ref();
	slot.timer = setTimeout(
		() => retire(slot, new InvalidPdfError("This PDF took too long to process. Try exporting it again or choose another file.")),
		PROCESSING_TIMEOUT_MS,
	);
	// The worker gets its own copy, so the caller keeps its bytes.
	slot.worker.postMessage({ id: 0, bytes: job.bytes.slice() });
}

/** A free worker, or a new one while the pool has room. */
function freeSlot() {
	const idle = slots.find((candidate) => !candidate.job);
	if (idle || slots.length >= poolSize()) return idle ?? null;
	try {
		return startSlot();
	} catch (error) {
		// With no worker at all, nothing would ever take the waiting PDFs.
		if (!slots.length) for (const job of waiting.splice(0)) job.reject(pdfReadError({ message: String(error) }, error));
		return null;
	}
}

/** Gives waiting PDFs to free workers, starting workers up to the pool size. */
function drain() {
	while (waiting.length) {
		const slot = freeSlot();
		if (!slot) return;
		assign(slot, waiting.shift()!);
	}
}

export async function processPdfInWorkers(bytes: Uint8Array): Promise<ProcessedPdf> {
	assertPdfHeader(bytes);
	return new Promise<ProcessedPdf>((resolve, reject) => {
		waiting.push({ bytes, resolve, reject });
		drain();
	});
}
