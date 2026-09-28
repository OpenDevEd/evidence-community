import { afterEach, expect, it, vi } from "vitest";
import { createPdf } from "../helpers/file-storage";

// The real pdf.js, except that bytes reading "%PDF-hang" open a document
// that never finishes loading or destroying.
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async (importOriginal) => {
	const pdfjs = await importOriginal<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>();
	return {
		...pdfjs,
		getDocument: (params: { data: Uint8Array }) =>
			Buffer.from(params.data).toString() === "%PDF-hang"
				? { promise: new Promise(() => {}), destroy: () => new Promise<void>(() => {}) }
				: pdfjs.getDocument(params),
	};
});

import { InvalidPdfError, processPdf } from "@/lib/admin/pdf-processing";

afterEach(() => vi.useRealTimers());

it("gives up on a PDF that never finishes and processes the next one", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
	const hanging = processPdf(new TextEncoder().encode("%PDF-hang"));
	const next = processPdf(await createPdf("Next"));
	const rejected = expect(hanging).rejects.toThrow(InvalidPdfError);

	// The time limit starts once pdf.js has loaded.
	await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
	await vi.advanceTimersByTimeAsync(60_000);

	await rejected;
	await expect(hanging).rejects.toThrow(/too long/);
	expect((await next).text).toContain("Next");
});
