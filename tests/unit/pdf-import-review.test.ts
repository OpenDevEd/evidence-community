import { describe, expect, it } from "vitest";

import { importable, readingNeeds, reviewRoute, type ImportBatch, type ImportRow } from "@/components/admin/admin-import";
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
		licences: new Map(),
		kind: "pdfs",
		needs: {},
		outcome: "drafts",
		publish: new Map(),
		publishRoute: "zenodo",
		results: rows.map(({ id }) => created(id)),
		reviews: {},
		rows,
		send: null,
		sending: {},
		toPublish: null,
	});
	const view = (current: ImportBatch) => publishView(current, () => {}, true);

	// A draft goes on with its PDF: one still attaching in another request, or whose PDF failed, can't.
	it("offers only drafts whose PDF is attached", () => {
		expect(view(batch([["1", "attached"]])).publishable).toEqual(["1"]);
		expect(view(batch([["1", "attached"], ["2", "failed"]]))).toMatchObject({ attached: 1, failedPdfs: true, publishable: ["1"] });
		expect(view(batch([])).publishable).toEqual([]);
	});

	// A send that failed for a moment, such as a DOI reservation, is tried again from here, without sending the others twice.
	it("lets the drafts a send failed on go again, and keeps the sent ones out", () => {
		const current = { ...batch([["1", "attached"], ["2", "attached"]]), publish: new Map([["1", { state: "published" as const }], ["2", { message: "Try again", state: "failed" as const }]]), toPublish: new Set(["1", "2"]) };
		expect(view(current)).toMatchObject({ choosing: true, publishable: ["2"], started: false });
		expect([...view(current).chosen]).toEqual(["2"]);
		// A finished run leaves nothing ticked, and a draft whose PDF came later can still go.
		const done = { ...current, publish: new Map([["1", { state: "published" as const }], ["2", { state: "published" as const }]]) };
		// With every draft sent, none is left to tick and the Publish button goes.
		expect(view(done)).toMatchObject({ choosing: false, publishable: [], sent: 2, started: false });
		const later = { ...batch([["1", "attached"], ["2", "attached"]]), publish: new Map([["1", { state: "published" as const }]]) };
		expect(view(later)).toMatchObject({ publishable: ["2"], started: false });
	});

	// A retry approves the review a failed send left pending, which keeps the DOI choice it was submitted with.
	it("holds the DOI route to a failed draft's pending review, and frees it once an editor withdraws it", async () => {
		const { routeOf } = await import("@/components/admin/admin-import");
		const failed = { ...batch([["1", "attached"]]), publish: new Map([["1", { message: "Zenodo publishing is not configured", state: "failed" as const }]]), publishRoute: "crossref-zenodo" as const };
		const pending = { ...failed, reviews: { 1: { id: "review-1", revision: 1, route: "zenodo" as const } } };
		expect(view(pending).routeHeld).toBe(true);
		expect(routeOf(pending)).toBe("zenodo");
		expect(view(failed).routeHeld).toBe(false);
		expect(routeOf(failed)).toBe("crossref-zenodo");
		// A draft imported with its DOI keeps it, so its review holds no route.
		const imported = { ...pending, results: [{ ...created("1"), kind: "imported" as const }] };
		expect(view(imported).routeHeld).toBe(false);
		expect(routeOf(imported)).toBe("crossref-zenodo");
	});

	// The server sends an import's drafts on as their PDFs attach; the finish step offers only what it couldn't send.
	it("holds back drafts the server is still sending on, and offers one whose send failed again", () => {
		const current = { ...batch([["1", "attached"], ["2", "attached"]]), send: { action: "submit" as const, route: null }, sending: { 1: { message: null, state: "waiting" as const }, 2: { message: "Zenodo couldn't be reached", state: "failed" as const } } };
		// The one it failed on is the editor's to send again, once the server has sent the rest; until then nothing is ticked.
		expect(view(current)).toMatchObject({ choosing: false, publishable: ["2"], routeHeld: true, serverSending: true });
		// A creator's import submits, so an editor looking at it is told it submits too.
		expect(view(current).verbs).toEqual(publishView(current, () => {}, false).verbs);
		// Once sent, the store takes the server's word that it is published.
		const sent = { ...current, publish: new Map([["1", { state: "published" as const }]]), sending: { 2: current.sending[2] } };
		expect(view(sent)).toMatchObject({ choosing: true, publishable: ["2"], routeHeld: false, serverSending: false });
	});

	// Worst first, so what needs the editor is on top: what can't go, then what can or is going, then what went.
	it("lists the drafts that can't go first and the sent ones last, the fewest passing checks first in each", () => {
		const check = (result: "met" | "not_met") => ({ criterion: "Credits FCDO", page: null, quote: null, recommendation: null, result });
		const rows = [row("1", { checks: [check("met")] }), row("2", { checks: [check("met")] }), row("3", { checks: [check("not_met")] }), row("4", { checks: [check("met")] }), row("5", { checks: [check("not_met")] })];
		const current = { ...batch([["1", "attached"], ["2", "attached"], ["3", "attached"], ["4", "failed"], ["5", "failed"]], rows), publish: new Map([["1", { state: "published" as const }]]) };
		expect(view(current).drafts.map(({ row }) => row.id)).toEqual(["5", "4", "3", "2", "1"]);
	});

	it("ticks the drafts that pass every check, and leaves the rest to the editor", () => {
		const current = view(batch([["1", "attached"], ["2", "attached"]]));
		expect([...current.chosen]).toEqual(["1"]);
		expect(current.label).toBe("Publish 1");
	});

	// An editor chooses between publishing and the review queue; what they chose, not their role, names the progress.
	it("offers an editor the review queue beside publishing, and names the send by the choice made", () => {
		const current = batch([["1", "attached"], ["2", "attached"]]);
		expect(view(current)).toMatchObject({ label: "Publish 1", queueLabel: "Send 1 to the queue" });
		const queued = view({ ...current, sendApproves: false });
		expect(queued.verbs.doing).toBe("Sending to the queue");
		// The button still says what it does: it publishes.
		expect(queued.label).toBe("Publish 1");
		expect(view({ ...current, sendApproves: true }).verbs.doing).toBe("Publishing");
	});

	// Sending an undated draft on Zenodo failed after the send; it now waits until the record editor completes it.
	it("holds back a draft until it has what its DOI route needs", () => {
		const undated = { ...batch([["1", "attached"], ["2", "attached"]]), needs: { 1: { zenodo: { date: "Enter a valid publication date." } } } };
		expect(view(undated)).toMatchObject({ chosen: new Set(), publishable: ["2"] });
		// Without a DOI, publishing doesn't need the date.
		expect(view({ ...undated, publishRoute: null }).publishable).toEqual(["1", "2"]);
	});
});

describe("what publishing needs from a reading", () => {
	const reading = (payload: Record<string, unknown>, overrides: Partial<ImportRow> = {}) => row("1", { record: { ...record, payload: { creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }], itemType: "Report", title: "A report", licence: { kind: "zenodo", id: "cc-by-4.0" }, ...payload } }, ...overrides });

	// A 2023 report read without a date was called Ready, imported, then failed to publish.
	it("flags a ready reading without a date, and still imports it", () => {
		const undated = reading({});
		const needs = readingNeeds(undated, new Set());
		expect(Object.keys(needs)).toEqual(["date"]);
		expect(rowStatus(undated, undefined, undefined, needs)).toMatchObject({ tone: "attention" });
		expect(importable(undated)).toBe(true);
	});

	it("needs nothing once the reading or an applied suggestion has the date, or when the record keeps its own DOI", () => {
		expect(readingNeeds(reading({ date: "2023" }), new Set())).toEqual({});
		expect(readingNeeds(reading({}, { suggestions: [{ apply: true, checks: [], field: "date", reason: "The cover says 2023.", value: "2023" }] }), new Set([0]))).toEqual({});
		expect(readingNeeds(reading({ DOI: "10.5072/report" }), new Set())).toEqual({});
		// Text that isn't a DOI gives the record no DOI of its own, so it takes the library's, as importing decides.
		expect(Object.keys(readingNeeds(reading({ DOI: "See the cover" }), new Set()))).toEqual(["date"]);
	});

	// Sources QA has no Zenodo, and its review asked each PDF that named no licence to pick one for a DOI it can't get.
	it("holds drafts to a DOI's needs only where the library has Zenodo", () => {
		const bare = reading({ licence: undefined });
		expect(Object.keys(readingNeeds(bare, new Set(), reviewRoute(null, true))).sort()).toEqual(["date", "licence"]);
		expect(readingNeeds(bare, new Set(), reviewRoute(null, false))).toEqual({});
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

// A record keeps the checks its PDF was read against; a failed one that a suggested change meets counts as met only while the record holds that change.
describe("a record's kept checks", () => {
	const kept = {
		checks: [
			{ criterion: "Credits FCDO", page: 2, quote: "Funded by UK aid", recommendation: null, result: "met" as const },
			{ criterion: "Crown copyright", page: null, quote: null, recommendation: "Add the line", result: "not_met" as const },
		],
		suggestions: [{ checks: [1], field: "rights", value: "© Crown copyright 2025" }],
	};
	it("counts a check met by a change the record holds, and not once it lost it", async () => {
		const { checkPasses, heldChecks } = await import("@/components/admin/admin-import");
		expect(heldChecks(kept, { rights: "© Crown copyright 2025" }).map(checkPasses)).toEqual([true, true]);
		expect(heldChecks(kept, { rights: "All rights reserved" }).map(checkPasses)).toEqual([true, false]);
	});

	it("matches a suggested value the way the record stores it once saved", async () => {
		const { checkPasses, heldChecks } = await import("@/components/admin/admin-import");
		const linked = { ...kept, suggestions: [{ checks: [1], field: "url", value: "https://example.org" }] };
		expect(heldChecks(linked, { itemType: "Report", url: "https://example.org/" }).map(checkPasses)).toEqual([true, true]);
	});
});
