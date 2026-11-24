import { forgetHosts } from "@opendeved/paper-pdf";
import { beforeEach, expect, it, vi } from "vitest";

const body = Buffer.concat([Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"), Buffer.alloc(1_200, " ")]);
/** The smallest file the search takes for a whole PDF: a first line, a table of objects and an ending that names it. */
const pdf = Buffer.concat([body, Buffer.from(`xref\n0 1\n0000000000 65535 f \ntrailer\n<<>>\nstartxref\n${body.byteLength}\n%%EOF\n`)]);
const answers = new Map<string, () => Response>();
const requested: string[] = [];
vi.mock("@/lib/public-fetch", () => ({
	publicTransport: vi.fn(async (input: string | URL) => {
		const url = new URL(input).href;
		requested.push(url);
		return answers.get(url)?.() ?? new Response("Not found", { status: 404 });
	}),
	// What reads a stored copy by its signed link.
	fetchPublicFile: vi.fn(async (url: URL) => {
		requested.push(url.href);
		const answer = answers.get(url.href)?.();
		if (!answer?.ok) throw new Error("Download returned 404");
		return { data: new Uint8Array(await answer.arrayBuffer()), contentType: "application/pdf", url };
	}),
}));
const { PdfNotFound, downloadPaperPdf } = await import("@/lib/source-ingestion/openalex/pdf-download");

const file = () => new Response(pdf, { headers: { "content-type": "application/pdf" } });
const page = (html: string, status = 200) => () => new Response(html, { status, headers: { "content-type": "text/html" } });
const json = (value: unknown) => () => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const search = (quick: boolean, memory = new Map<string, unknown>()) => ({ maxBytes: 1_000_000, memory, openalexId: "W1", quick });

beforeEach(() => {
	answers.clear();
	requested.length = 0;
	forgetHosts();
});

it("keeps the chosen link when it is a PDF and asks nobody else", async () => {
	answers.set("https://publisher.example/a.pdf", file);

	const bytes = await downloadPaperPdf("https://publisher.example/a.pdf", { otherCopies: ["https://repo.example/a.pdf"], doi: "10.1/a" }, search(true));

	expect(Buffer.from(bytes).equals(pdf)).toBe(true);
	expect(requested).toEqual(["https://publisher.example/a.pdf"]);
});

it("tries the work's other open copies when the chosen link returns a sign-in page", async () => {
	answers.set("https://publisher.example/b.pdf", page("<html><body>Please sign in</body></html>"));
	answers.set("https://repo.example/b.pdf", file);

	const bytes = await downloadPaperPdf("https://publisher.example/b.pdf", { otherCopies: ["https://repo.example/b.pdf"], doi: "10.1/b" }, search(true));

	expect(Buffer.from(bytes).equals(pdf)).toBe(true);
});

it("asks Crossref only in the full search, and says what the record's link did when nothing is found", async () => {
	answers.set("https://publisher.example/c.pdf", page("Forbidden", 403));
	answers.set("https://api.crossref.org/works/10.1%2Fc?mailto=habari%40openscholar.ai", json({ message: { DOI: "10.1/c", link: [{ URL: "https://mirror.example/c.pdf", "content-type": "application/pdf" }] } }));
	answers.set("https://mirror.example/c.pdf", file);
	const record = { doi: "10.1/c" };

	const quick = await downloadPaperPdf("https://publisher.example/c.pdf", record, search(true)).catch((error: unknown) => error);

	expect(quick).toBeInstanceOf(PdfNotFound);
	expect(quick).toMatchObject({ full: false, message: "The site that holds the PDF refuses automated requests (HTTP 403)" });
	expect(requested.filter((url) => !url.includes("publisher.example") && !url.startsWith("https://doi.org/"))).toEqual([]);

	const bytes = await downloadPaperPdf("https://publisher.example/c.pdf", record, search(false));

	expect(Buffer.from(bytes).equals(pdf)).toBe(true);
});

it("asks nothing for a paper a full search already failed to find, until its time comes", async () => {
	const memory = new Map<string, unknown>();
	const record = { doi: "10.1/d" };
	await expect(downloadPaperPdf("https://publisher.example/d.pdf", record, search(false, memory))).rejects.toThrow("No link returned the paper's PDF");
	requested.length = 0;

	const again = await downloadPaperPdf("https://publisher.example/d.pdf", record, search(true, memory)).catch((error: unknown) => error);

	expect(again).toMatchObject({ miss: { remembered: true }, message: "No link returned the paper's PDF, as an earlier search found" });
	expect(requested).toEqual([]);
});

it("reads Openscholar's stored copy first in the full search, and never asks for it in the quick one", async () => {
	const signed = "https://store.example/openalex/W1.pdf?signature=1";
	answers.set(signed, file);
	const stored = vi.fn(async () => signed);

	const bytes = await downloadPaperPdf("https://publisher.example/e.pdf", { doi: "10.1/e" }, { ...search(false), stored });

	expect(Buffer.from(bytes).equals(pdf)).toBe(true);
	expect(stored).toHaveBeenCalledWith({ openalexId: "W1", url: "https://publisher.example/e.pdf" });
	expect(requested).toEqual([signed]);

	// A store that fails, or has no copy, leaves the search to go on.
	answers.set("https://publisher.example/e.pdf", file);
	const failing = vi.fn(async () => Promise.reject(new Error("Openscholar did not answer")));
	vi.spyOn(console, "warn").mockImplementation(() => {});
	expect(Buffer.from(await downloadPaperPdf("https://publisher.example/e.pdf", {}, { ...search(false), stored: failing })).equals(pdf)).toBe(true);

	stored.mockClear();
	await downloadPaperPdf("https://publisher.example/e.pdf", {}, { ...search(true), stored });
	expect(stored).not.toHaveBeenCalled();
});
