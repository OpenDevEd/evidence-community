"use client";

type PdfJs = typeof import("pdfjs-dist");

const THUMBNAIL_WIDTH = 360;
const AT_ONCE = 3;

let library: Promise<PdfJs> | null = null;
// A chosen file is drawn once per file, a stored PDF once per address.
const thumbnails = new WeakMap<File, Promise<string | null>>();
const storedThumbnails = new Map<string, Promise<string | null>>();
const pageCounts = new WeakMap<File, Promise<number | null>>();
let running = 0;
const waiting: Array<() => void> = [];

function pdfjs() {
	library ??= import("pdfjs-dist").then((lib) => {
		lib.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
		return lib;
	});
	return library;
}

async function inTurn<T>(work: () => Promise<T>) {
	if (running >= AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
	running += 1;
	try {
		return await work();
	} finally {
		running -= 1;
		waiting.shift()?.();
	}
}

const bytesOf = async (source: File | string) => new Uint8Array(await (typeof source === "string" ? (await fetch(source)).arrayBuffer() : source.arrayBuffer()));

async function render(source: File | string) {
	const lib = await pdfjs();
	const task = lib.getDocument({ data: await bytesOf(source) });
	const document = await task.promise;
	try {
		const page = await document.getPage(1);
		const viewport = page.getViewport({ scale: THUMBNAIL_WIDTH / page.getViewport({ scale: 1 }).width });
		const canvas = window.document.createElement("canvas");
		canvas.width = Math.round(viewport.width);
		canvas.height = Math.round(viewport.height);
		await page.render({ canvas, viewport }).promise;
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
		return blob ? URL.createObjectURL(blob) : null;
	} finally {
		await task.destroy();
	}
}

/**
 * The first page of a PDF as an image URL, drawn in the browser: a chosen
 * file before anything is uploaded, or one stored with the import. Null
 * when it can't be drawn.
 */
export function pdfThumbnail(source: File | string) {
	let thumbnail = typeof source === "string" ? storedThumbnails.get(source) : thumbnails.get(source);
	if (!thumbnail) {
		thumbnail = inTurn(() => render(source)).catch(() => null);
		if (typeof source === "string") storedThumbnails.set(source, thumbnail);
		else thumbnails.set(source, thumbnail);
	}
	return thumbnail;
}

async function countPages(file: File) {
	const lib = await pdfjs();
	const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
	try {
		return (await task.promise).numPages;
	} finally {
		await task.destroy();
	}
}

/** How many pages a chosen PDF has, read once per file. Null when it can't be opened. */
export function pdfPageCount(file: File) {
	let count = pageCounts.get(file);
	if (!count) {
		count = inTurn(() => countPages(file)).catch(() => null);
		pageCounts.set(file, count);
	}
	return count;
}
