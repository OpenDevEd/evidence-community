import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { uploadPdfFile } from "@/components/admin/admin-pdf";

afterEach(() => vi.unstubAllGlobals());

it.each([
	"application/pdf",
	"application/octet-stream",
	"application/x-pdf",
	"",
])(
	"uploads a PDF with MIME type %j and completes the staged revision",
	async (type) => {
		const file = new File(["PDF fixture bytes"], "report.pdf", {
			type,
		});
		const requests: Array<{ url: string; body: unknown }> = [];
		vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
			requests.push({ url, body: init.body });
			if (url.endsWith("/file"))
				return Response.json({
					fileDraft: { uploadRevision: 7 },
					upload: { signedUrl: "https://storage.test/upload" },
				});
			return Response.json({});
		});
		await uploadPdfFile("PDF12345", file, () => {});
		expect(requests.map(({ url }) => url)).toEqual([
			"/api/admin/items/PDF12345/file",
			"https://storage.test/upload",
			"/api/admin/items/PDF12345/file/complete",
		]);
		expect(JSON.parse(String(requests[0].body))).toEqual({
			filename: "report.pdf",
			expectedSizeBytes: 17,
			expectedSha256: createHash("sha256")
				.update("PDF fixture bytes")
				.digest("hex"),
		});
		if (!(requests[1].body instanceof FormData))
			throw new Error("Expected file upload");
		const uploaded = requests[1].body.get("");
		if (!(uploaded instanceof File)) throw new Error("Expected PDF bytes");
		expect(await uploaded.text()).toBe("PDF fixture bytes");
		expect(JSON.parse(String(requests[2].body))).toEqual({
			expectedUploadRevision: 7,
		});
	},
);

it("does not mark a failed storage upload complete", async () => {
	const urls: string[] = [];
	vi.stubGlobal("fetch", async (url: string) => {
		urls.push(url);
		return url.endsWith("/file")
			? Response.json({
					fileDraft: { uploadRevision: 3 },
					upload: { signedUrl: "https://storage.test/upload" },
				})
			: Response.json({ message: "Unavailable" }, { status: 503 });
	});
	await expect(
		uploadPdfFile(
			"PDF12345",
			new File(["PDF"], "report.pdf", { type: "application/pdf" }),
			() => {},
		),
	).rejects.toThrow();
	expect(urls).toEqual([
		"/api/admin/items/PDF12345/file",
		"https://storage.test/upload",
	]);
});

it.each([
	new File([], "empty.pdf", { type: "application/pdf" }),
	new File(["text"], "notes.txt", { type: "text/plain" }),
])(
	"rejects an empty or non-PDF file before starting an upload",
	async (file) => {
		const network = vi.fn();
		vi.stubGlobal("fetch", network);
		await expect(
			uploadPdfFile("PDF12345", file, () => {}),
		).rejects.toThrow();
		expect(network).not.toHaveBeenCalled();
	},
);
