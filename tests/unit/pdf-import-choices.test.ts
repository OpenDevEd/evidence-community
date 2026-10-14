// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

import type { AdminPdfImport, PdfReading } from "@/lib/admin/item-import-contract";

const reading: PdfReading = {
	checks: [],
	cites: [],
	collections: [{ id: "THEMEGEN", name: "Gender Equality", path: ["Themes"], reason: "It is about girls." }],
	pdf: { reason: "damaged", writable: false },
	record: { creators: [], id: "1", itemType: "Report", method: "pdf", payload: { itemType: "Report", title: "A report" }, source: "report.pdf", state: "ready", title: "A report", year: 2026 },
	sha256: "0".repeat(64),
	suggestions: [{ apply: true, checks: [], field: "abstractNote", reason: "The PDF has none.", value: "A summary." }],
	topics: [],
};
const server: AdminPdfImport = {
	attach: {},
	checks: [],
	collections: [],
	createdAt: "2026-10-14T08:00:00.000Z",
	files: [{ filename: "report.pdf", id: "file-1", message: null, reading, rowId: "1", state: "read", stored: true }],
	id: "import-1",
	instructions: "",
	results: null,
};

afterEach(() => window.localStorage.clear());

// The PDF import lives on the server and survives a reload; the editor's work on it must too.
it("keeps the editor's choices on a PDF import through a reload, and drops them when the import ends", async () => {
	const tab = await import("@/components/admin/admin-import");
	const batch = tab.pdfImportBatch(server);
	tab.startImportBatch({ checks: [], collections: [], importId: batch.importId, kind: "pdfs", rows: batch.rows });
	tab.changeImportBatch(batch, (current) => tab.withSuggestionToggled(current, "1", 0));
	tab.changeImportBatch(batch, (current) => tab.withChoiceToggled(current, "1", "collections", "THEMEGEN"));
	tab.changeImportBatch(batch, (current) => ({ ...current, collections: ["THEMEGEN"], excluded: new Set(["1"]), publishRoute: "crossref-zenodo" }));
	tab.changeImportBatch(batch, (current) => ({ ...current, publish: new Map([["1", { state: "published" as const }], ["2", { state: "sending" as const }]]) }));

	vi.resetModules();
	const reloaded = await import("@/components/admin/admin-import");
	const restored = reloaded.pdfImportBatch(server);
	const row = restored.rows[0]!;
	expect(reloaded.appliedOf(restored, row).size).toBe(0);
	expect(reloaded.chosenOf(restored, row, "collections").size).toBe(0);
	expect(restored).toMatchObject({ collections: ["THEMEGEN"], excluded: new Set(["1"]), publishRoute: "crossref-zenodo" });
	// A published draft stays published; a send the reload cut off is no longer under way.
	expect(restored.publish).toEqual(new Map([["1", { state: "published" }]]));
	// Another import starts from the AI's choices.
	expect(reloaded.appliedOf(reloaded.pdfImportBatch({ ...server, id: "import-2" }), row)).toEqual(new Set([0]));

	tab.endImportBatch("import-1");
	expect(reloaded.appliedOf(reloaded.pdfImportBatch(server), row)).toEqual(new Set([0]));
});
