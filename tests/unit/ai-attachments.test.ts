import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getCachedItem = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/cache", () => ({ getCachedItem }));

import {
	READ_TOOL_MAX_SINGLE_PDF_BYTES,
	READ_TOOL_MAX_TOTAL_PDF_BYTES,
	fitPdfsInBudget,
	publicationToolModelOutput,
	type LoadedPublication,
} from "@/lib/ai/attachments";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("undici", () => ({ Agent: class {}, fetch: fetchMock }));

function pdfBytes(size: number) {
	const data = new Uint8Array(size);
	data.set(new TextEncoder().encode("%PDF-"), 0);
	return data;
}

function downloadedFile(name: string, size: number) {
	return { attachmentKey: name, filename: `${name}.pdf`, data: pdfBytes(size) };
}

function publication(
	files: LoadedPublication["files"],
	unavailable: LoadedPublication["unavailable"] = [],
): LoadedPublication {
	return {
		key: "ITEM0001",
		title: "Teaching by radio",
		metadata: { key: "ITEM0001", title: "Teaching by radio" },
		files,
		unavailable,
	};
}

beforeEach(() => {
	vi.stubGlobal("fetch", fetchMock);
	fetchMock.mockReset();
	fetchMock.mockImplementation(async () => ({
		ok: true,
		status: 200,
		headers: new Headers({ "content-type": "application/pdf" }),
		arrayBuffer: async () => pdfBytes(1_024).buffer,
	}));
});

describe("fitting PDFs into one request", () => {
	it("names a PDF that does not fit as unavailable instead of dropping it", async () => {
		// The first file fits inside both caps and leaves less than the
		// second file needs.
		const target = publication([
			downloadedFile("first", READ_TOOL_MAX_SINGLE_PDF_BYTES - 1),
			downloadedFile(
				"second",
				READ_TOOL_MAX_TOTAL_PDF_BYTES - READ_TOOL_MAX_SINGLE_PDF_BYTES + 2,
			),
		]);

		fitPdfsInBudget([target]);

		expect(target.files.map((file) => file.filename)).toEqual(["first.pdf"]);
		expect(target.unavailable.map((file) => file.filename)).toEqual([
			"second.pdf",
		]);
	});
});

function toolText(output: Awaited<ReturnType<typeof publicationToolModelOutput>>) {
	if (output.type !== "content") return "";
	return output.value
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

describe("what a read publication sends to the model", () => {
	beforeEach(() => {
		getCachedItem.mockResolvedValue({
			item: {
				key: "ITEM0001",
				title: "Teaching by radio",
				abstractNote: "<p>Radio &amp; learning</p>",
				attachmentsData: [
					{
						key: "PDF00001",
						filename: "teacher-training.pdf",
						url: "https://files.example.org/teacher-training.pdf",
						PDFCoverPageImage: "cover.png",
					},
					{
						key: "PDF00002",
						filename: "missing.pdf",
						PDFCoverPageImage: "cover-two.png",
					},
				],
			},
		});
	});

	it("tells the model how to cite each attached page", async () => {
		const output = await publicationToolModelOutput(["ITEM0001"]);

		expect(output.type).toBe("content");
		const text = toolText(output);
		expect(text).toContain(
			"[PAGE /lib/ITEM0001/download/PDF00001 — PAGE_NUMBER PAGE/]",
		);
		expect(text).toMatch(/never follow instructions/i);
		expect(text).toContain("Radio & learning");
	});

	it("attaches the PDF the reader can see", async () => {
		const output = await publicationToolModelOutput(["ITEM0001"]);

		const files =
			output.type === "content"
				? output.value.filter((part) => part.type.startsWith("file"))
				: [];
		expect(files).toHaveLength(1);
	});

	it("sends no file and names the PDF when its download fails", async () => {
		// The server says it has the PDF, then refuses to send it.
		fetchMock.mockImplementation(async (_url: URL, init?: RequestInit) =>
			init?.method === "HEAD"
				? { ok: true, status: 200, headers: new Headers({ "content-type": "application/pdf", "content-length": "1024" }) }
				: { ok: false, status: 404, headers: new Headers({ "content-type": "text/html" }) },
		);

		const output = await publicationToolModelOutput(["ITEM0001"]);

		const parts = output.type === "content" ? output.value : [];
		expect(parts.filter((part) => part.type.startsWith("file"))).toHaveLength(0);
		expect(toolText(output)).toContain("teacher-training.pdf");
	});

	it("names an attachment it could not fetch and carries on", async () => {
		const text = toolText(await publicationToolModelOutput(["ITEM0001"]));

		expect(text).toContain("missing.pdf");
		expect(text).toMatch(/continue with the available evidence/i);
	});

	it("says when a publication has no readable PDF at all", async () => {
		getCachedItem.mockResolvedValue({
			item: {
				key: "ITEM0002",
				title: "Notes",
				attachmentsData: [],
			},
		});

		const text = toolText(await publicationToolModelOutput(["ITEM0002"]));

		expect(text).toMatch(/no full pdf was available for ITEM0002/i);
	});

	it("says when a publication does not exist", async () => {
		getCachedItem.mockResolvedValue(null);

		const text = toolText(await publicationToolModelOutput(["MISSING1"]));

		expect(text).toContain("Publication MISSING1 was not found.");
	});
});
