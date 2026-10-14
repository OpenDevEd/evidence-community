import { describe, expect, it } from "vitest";

import type { ImportBatch, ImportRow } from "@/components/admin/admin-import";
import { publishView } from "@/components/admin/ImportDone";
import { propertiesAside, rowStatus } from "@/components/admin/ImportReview";
import type { AdminImportCommitResult, AdminImportPreviewRecord } from "@/lib/admin/item-import-contract";
import type { PdfProperties } from "@/lib/admin/pdf-record-mapping";

const record: AdminImportPreviewRecord = { creators: [], id: "1", itemType: "Report", method: "pdf", payload: {}, source: "report.pdf", state: "ready", title: "A report", year: 2026 };
const row = (id: string, overrides: Partial<ImportRow> = {}): ImportRow => ({
	checks: [],
	cites: [],
	collections: [],
	id,
	pdf: null,
	record: { ...record, id },
	source: { filename: `${id}.pdf`, url: `/pdf/${id}` },
	state: "read",
	suggestions: [],
	topics: [],
	...overrides,
});
const created = (id: string): AdminImportCommitResult => ({ id, itemKey: `KEY${id}`, kind: "created", outcome: "created" });

describe("a PDF row's status", () => {
	it("says where the PDF has got to before anything else", () => {
		expect(rowStatus(row("1", { state: "waiting" }), undefined, undefined).label).toBe("Queued");
		expect(rowStatus(row("1", { record: null, state: "failed" }), undefined, undefined).label).toBe("Could not read");
	});

	// A draft without its PDF isn't what the editor imported, so that outranks "Draft created".
	it("says a draft's PDF didn't attach rather than that the draft was made", () => {
		expect(rowStatus(row("1"), created("1"), "failed").label).toBe("PDF not attached");
		expect(rowStatus(row("1"), created("1"), "attached").label).toBe("Draft created");
		expect(rowStatus(row("1"), { id: "1", message: "Bad date", outcome: "failed" }, undefined).label).toBe("Not imported");
	});
});

describe("the finish step", () => {
	const batch = (attach: [string, "attached" | "failed"][], rows = [row("1"), row("2", { checks: [{ criterion: "Credits FCDO", page: null, quote: null, recommendation: "Add the credit", result: "not_met" }] })]): ImportBatch => ({
		applied: new Map(),
		attach: new Map(attach),
		checks: [],
		chosen: { collections: new Map(), topics: new Map() },
		collections: [],
		committing: false,
		excluded: new Set(),
		importId: "import-1",
		kind: "pdfs",
		publish: new Map(),
		publishRoute: "zenodo",
		results: rows.map(({ id }) => created(id)),
		rows,
		toPublish: null,
	});
	const view = (current: ImportBatch) => publishView(current, () => {}, true);

	// A draft goes on with its PDF: one still attaching in another request, or whose PDF failed, can't.
	it("offers only drafts whose PDF is attached", () => {
		expect(view(batch([["1", "attached"]])).publishable).toEqual(["1"]);
		expect(view(batch([["1", "attached"], ["2", "failed"]]))).toMatchObject({ attached: 1, failedPdfs: true, publishable: ["1"] });
		expect(view(batch([])).publishable).toEqual([]);
	});

	it("ticks the drafts that pass every check, and leaves the rest to the editor", () => {
		const current = view(batch([["1", "attached"], ["2", "attached"]]));
		expect([...current.chosen]).toEqual(["1"]);
		expect(current.label).toBe("Publish 1");
	});
});

describe("what publishing does to a PDF's properties", () => {
	const empty: PdfProperties = { authors: [], date: "", doi: "", isbn: "", issn: "", issue: "", keywords: [], language: "", pages: "", publicationTitle: "", publisher: "", rights: "", seriesNumber: "", seriesTitle: "", subject: "", title: "", volume: "" };
	const reading = (properties: Partial<PdfProperties>) => ({ properties: { ...empty, ...properties }, standards: { pdfa: "", pdfua: "", tagged: false }, writable: true as const });

	it("counts what it adds, changes and removes", () => {
		expect(propertiesAside({ ...empty, authors: ["Ada Lovelace"], doi: "10.5072/x", title: "New title" }, reading({ rights: "© Someone", title: "Old title" }))).toBe("Publishing adds 2, changes 1, removes 1");
	});

	// Zenodo gives the record a DOI when it publishes, so a record without one doesn't take the file's away.
	it("never counts a DOI the record doesn't have yet as removed", () => {
		expect(propertiesAside(empty, reading({ doi: "10.5072/old" }))).toBe("Publishing changes 1");
		expect(propertiesAside({ ...empty, title: "Same" }, reading({ title: "Same" }))).toBe("Publishing adds 1");
	});

	it("says nothing for a PDF it can't write", () => {
		expect(propertiesAside(empty, { reason: "password", writable: false })).toBeUndefined();
	});
});
