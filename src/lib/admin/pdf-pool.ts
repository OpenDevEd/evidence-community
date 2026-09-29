import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

import { assertPdfHeader, InvalidPdfError, pdfReadError, type ProcessedPdf } from "./pdf-processing";

// Imports read PDFs in worker threads, so several are read at once on other
// cores. Each worker reads one PDF at a time; one that runs out of time is
// stopped and replaced, which also ends a hung pdf.js.
const MAX_WORKERS = 4;
const PROCESSING_TIMEOUT_MS = 60_000;

type Reply = { result?: ProcessedPdf; error?: { invalid: boolean; message: string } };
type Job = { bytes: Uint8Array; resolve: (result: ProcessedPdf) => void; reject: (error: Error) => void };

const idle: Worker[] = [];
const waiting: Job[] = [];
let started = 0;

const poolSize = () => Math.min(MAX_WORKERS, Math.max(1, availableParallelism() - 1));

function run(worker: Worker, job: Job) {
	worker.ref();
	const finish = (outcome: () => void) => {
		clearTimeout(timer);
		worker.off("message", reply);
		worker.off("error", failed);
		outcome();
	};
	const reply = ({ result, error }: Reply) => {
		finish(() => (result ? job.resolve(result) : job.reject(pdfReadError({ name: error?.invalid ? "InvalidPdfContent" : "Error", message: error?.message ?? "" }))));
		release(worker);
	};
	const failed = (error: Error) => {
		finish(() => job.reject(pdfReadError(error, error)));
		replace(worker);
	};
	const timer = setTimeout(() => {
		finish(() => job.reject(new InvalidPdfError("This PDF took too long to process. Try exporting it again or choose another file.")));
		replace(worker);
	}, PROCESSING_TIMEOUT_MS);
	worker.on("message", reply);
	worker.on("error", failed);
	// The worker gets its own copy, so the caller keeps its bytes.
	worker.postMessage({ id: 0, bytes: job.bytes.slice() });
}

/** Gives a free worker the next waiting PDF, or lets it sit idle. */
function release(worker: Worker) {
	const job = waiting.shift();
	if (job) return run(worker, job);
	worker.unref();
	idle.push(worker);
}

/** A worker that failed or ran out of time is ended and its place taken by a new one. */
function replace(worker: Worker) {
	void worker.terminate();
	started--;
	const job = waiting.shift();
	if (job) dispatch(job);
}

function dispatch(job: Job) {
	const worker = idle.pop() ?? (started < poolSize() ? (started++, new Worker(new URL("./pdf-worker.mjs", import.meta.url))) : null);
	if (worker) run(worker, job);
	else waiting.push(job);
}

export async function processPdfInWorkers(bytes: Uint8Array): Promise<ProcessedPdf> {
	assertPdfHeader(bytes);
	return new Promise<ProcessedPdf>((resolve, reject) => dispatch({ bytes, resolve, reject }));
}
