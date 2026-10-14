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
	needs: {},
	results: null,
	send: null,
	sending: {},
	reviews: {},
	sent: {},
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

// A draft sent on from another tab or browser shows as sent here too; this tab's own failed send stays to be tried again, with the review the server says is pending, unless the server says it was published after all.
it("takes in what other tabs sent, without overriding a send this tab can still retry", async () => {
	const tab = await import("@/components/admin/admin-import");
	const batch = tab.pdfImportBatch(server);
	tab.startImportBatch({ checks: [], collections: [], importId: batch.importId, kind: "pdfs", rows: batch.rows });
	tab.changeImportBatch(batch, (current) => ({ ...current, publish: new Map([["1", { message: "The connection dropped", state: "failed" as const }], ["2", { message: "Try again", state: "failed" as const }]]) }));
	vi.resetModules();
	const reloaded = await import("@/components/admin/admin-import");
	const restored = reloaded.pdfImportBatch({ ...server, reviews: { 2: { id: "review-2", revision: 1 } }, sent: { 1: "published", 2: "submitted" } });
	expect(restored.publish.get("1")).toEqual({ state: "published" });
	expect(restored.publish.get("2")).toEqual({ message: "Try again", state: "failed" });
	expect(restored.reviews).toEqual({ 2: { id: "review-2", revision: 1 } });
});

// The server sends an import's drafts on as their PDFs attach. One it submitted and failed to approve can be tried
// again here, which approves that review, and the DOI route starts as the one the server sent them on.
it("offers a draft the server submitted and failed to approve to try again, on the server's route", async () => {
	const tab = await import("@/components/admin/admin-import");
	const batch = tab.pdfImportBatch({
		...server,
		id: "import-sent",
		reviews: { 1: { id: "review-1", revision: 1 } },
		send: { action: "publish", route: "zenodo" },
		sending: { 1: { message: "Zenodo is down", state: "failed" } },
		sent: { 1: "submitted" },
	});
	expect(batch.publish.get("1")).toEqual({ message: "Zenodo is down", state: "failed" });
	expect(batch.publishRoute).toBe("zenodo");
});

// A creator's import only submits, so its failed send that the creator then submitted from here is submitted, not an
// approval to try again; and a draft the server is still sending is on its way, whatever its review says meanwhile.
it("keeps a creator's retry submitted, and a draft the server still sends on its way", async () => {
	const tab = await import("@/components/admin/admin-import");
	const batch = tab.pdfImportBatch({
		...server,
		id: "import-creator",
		reviews: { 1: { id: "review-1", revision: 1 }, 2: { id: "review-2", revision: 1 } },
		send: { action: "submit", route: null },
		sending: { 1: { message: "Zenodo is down", state: "failed" }, 2: { message: null, state: "waiting" } },
		sent: { 1: "submitted", 2: "submitted" },
	});
	expect(batch.publish.get("1")).toEqual({ state: "submitted" });
	expect(batch.publish.has("2")).toBe(false);
});

// Another tab chose a route and this one committed with another: while the server sends, its route is the one shown
// and used.
it("takes the server's DOI route while it sends, over a route this browser chose before", async () => {
	const tab = await import("@/components/admin/admin-import");
	const sending = { ...server, id: "import-route", send: { action: "publish" as const, route: "zenodo" as const }, sending: { 1: { message: null, state: "waiting" as const } } };
	const batch = tab.pdfImportBatch({ ...sending, send: null, sending: {} });
	tab.startImportBatch({ checks: [], collections: [], importId: batch.importId, kind: "pdfs", rows: batch.rows });
	tab.changeImportBatch(batch, (current) => ({ ...current, publishRoute: "crossref-zenodo" }));
	vi.resetModules();
	const reloaded = await import("@/components/admin/admin-import");
	expect(reloaded.pdfImportBatch(sending).publishRoute).toBe("zenodo");
	// A draft it submitted and couldn't approve waits in a review on its route, which a retry approves.
	const pending = { ...sending, reviews: { 1: { id: "review-1", revision: 1 } }, sending: { 1: { message: "Zenodo is down", state: "failed" as const } }, sent: { 1: "submitted" as const } };
	expect(reloaded.pdfImportBatch(pending).publishRoute).toBe("zenodo");
	// Withdrawn, the review no longer holds it.
	expect(reloaded.pdfImportBatch({ ...pending, reviews: {}, sent: {} }).publishRoute).toBe("crossref-zenodo");
	expect(reloaded.pdfImportBatch({ ...sending, sending: {} }).publishRoute).toBe("crossref-zenodo");
});
