// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const pdf = (key: string, filename: string) => ({ key, filename, PDFCoverPageImage: "cover.png" });
// Every publication the conversation touched comes back from the library with its PDFs.
vi.mock("swr", () => ({
	default: () => ({
		data: [
			{ key: "FOUND111", attachmentsData: [pdf("PDFFOUND", "found.pdf")] },
			{ key: "READ2222", attachmentsData: [pdf("PDFREAD1", "read.pdf")] },
		],
		isLoading: false,
	}),
}));
vi.mock("@/components/features/items/Resource", () => ({ default: () => null }));

import { useBucketPublications } from "@/components/features/ai/ContextBucket";
import { bucketPdfCitationSources, parsePageCitations } from "@/lib/ai/citations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("which PDFs a page citation may open", () => {
	it("only those the assistant read, not ones it found or linked to", async () => {
		function Probe() {
			const { pdfSources } = useBucketPublications([{ key: "FOUND111", source: "search" }, { key: "READ2222", source: "read" }]);
			return <output>{JSON.stringify(pdfSources)}</output>;
		}
		const container = document.createElement("div");
		const root = createRoot(container);
		await act(async () => root.render(<Probe />));
		const sources = JSON.parse(container.textContent ?? "{}") as Record<string, string>;
		expect(parsePageCitations("/lib/READ2222/download/PDFREAD1 — 4", sources)[0].href).toBe("/lib/READ2222/download/PDFREAD1#page=4");
		expect(parsePageCitations("/lib/FOUND111/download/PDFFOUND — 4", sources)[0].href).toBeUndefined();
		await act(async () => root.unmount());
	});

	it("keeps a PDF citable by its own address when another read PDF has the same name", () => {
		const sources = bucketPdfCitationSources(["NEWER111", "OLDER222"], {
			NEWER111: [pdf("PDFNEWER", "report.pdf")],
			OLDER222: [pdf("PDFOLDER", "report.pdf"), pdf("PDFANNEX", "annex.pdf")],
		});
		// The name means the newest publication's PDF; the older one is still opened by its address, not its annex.
		expect(parsePageCitations("report.pdf — 2", sources)[0].href).toBe("/lib/NEWER111/download/PDFNEWER#page=2");
		expect(parsePageCitations("/lib/OLDER222/download/PDFOLDER — 2", sources)[0].href).toBe("/lib/OLDER222/download/PDFOLDER#page=2");
	});
});
