import { describe, expect, it } from "vitest";

import { SourceCredentialNotFoundError } from "@/lib/source-ingestion/credentials";
import { OpenAlexApiError } from "@/lib/source-ingestion/openalex/client";
import {
	classifySourceError,
	sourceStatus,
	type SourceStatusInput,
} from "@/lib/source-ingestion/source-status";
import { ZoteroApiError } from "@/lib/source-ingestion/zotero/client";
import { ZoteroSnapshotTooLargeError } from "@/lib/source-ingestion/zotero/connection";

const now = new Date("2026-09-27T12:10:00.000Z");
const minutesAgo = (minutes: number) =>
	new Date(now.getTime() - minutes * 60_000);

function input(overrides: Partial<SourceStatusInput> = {}): SourceStatusInput {
	return {
		activeRun: null,
		issues: {},
		key: "zotero-2129771",
		lastChange: null,
		lastError: null,
		lastSuccessAt: null,
		now,
		provider: "zotero",
		search: null,
		searchFailed: 0,
		pdfs: null,
		searchable: 0,
		...overrides,
	};
}

describe("sourceStatus", () => {
	it("shows a run that reported records as importing, with time left from its rate so far", () => {
		const status = sourceStatus(
			input({
				activeRun: {
					leaseExpiresAt: minutesAgo(-5),
					recordsDone: 3_000,
					recordsFrom: 0,
					recordsFromAt: minutesAgo(2),
					recordsTotal: 12_000,
					startedAt: minutesAgo(2),
				},
			}),
		);
		expect(status).toMatchObject({
			done: 3_000,
			minutesLeft: 6,
			phase: "import",
			startedAt: minutesAgo(2).toISOString(),
			state: "running",
			total: 12_000,
		});
	});

	it("measures a resumed import's rate from where this run picked up", () => {
		const status = sourceStatus(
			input({
				activeRun: {
					leaseExpiresAt: minutesAgo(-5),
					recordsDone: 9_100,
					recordsFrom: 9_000,
					recordsFromAt: minutesAgo(1),
					recordsTotal: 10_000,
					startedAt: minutesAgo(2),
				},
			}),
		);
		expect(status).toMatchObject({ done: 9_100, minutesLeft: 9, state: "running" });
	});

	it("does not call a run importing before it reports anything, so no-change runs do not flash", () => {
		const status = sourceStatus(
			input({
				activeRun: {
					leaseExpiresAt: minutesAgo(-5),
					recordsDone: 0,
					recordsFrom: null,
					recordsFromAt: null,
					recordsTotal: null,
					startedAt: minutesAgo(0),
				},
				lastSuccessAt: minutesAgo(1),
				searchable: 40,
			}),
		);
		expect(status.state).toBe("succeeded");
	});

	it("shows an import picked up after a restart as importing, not as the interrupted run's failure", () => {
		const status = sourceStatus(
			input({
				activeRun: {
					leaseExpiresAt: minutesAgo(-5),
					recordsDone: 0,
					recordsFrom: null,
					recordsFromAt: null,
					recordsTotal: null,
					startedAt: minutesAgo(0),
				},
				lastError: {
					at: minutesAgo(0),
					code: "interrupted",
					details: "SourceLeaseLostError: worker lease expired",
				},
			}),
		);
		expect(status).toMatchObject({ phase: "import", state: "running" });
	});

	it("keeps the total unknown when the source has not said it", () => {
		const status = sourceStatus(
			input({
				activeRun: {
					leaseExpiresAt: minutesAgo(-5),
					recordsDone: 200,
					recordsFrom: 0,
					recordsFromAt: minutesAgo(1),
					recordsTotal: null,
					startedAt: minutesAgo(1),
				},
			}),
		);
		expect(status).toMatchObject({ minutesLeft: null, state: "running", total: null });
	});

	it("shows search progress after the import finished, even when a newer run already succeeded", () => {
		const status = sourceStatus(
			input({
				lastSuccessAt: minutesAgo(0),
				search: { done: 900, startedAt: minutesAgo(3), total: 1_200 },
			}),
		);
		expect(status).toMatchObject({
			done: 900,
			minutesLeft: 1,
			phase: "search",
			state: "running",
			total: 1_200,
		});
	});

	it("puts a failed import ahead of search work still waiting", () => {
		const status = sourceStatus(
			input({
				lastError: { at: minutesAgo(1), code: "access_denied", details: "ZoteroApiError: 403" },
				search: { done: 1, startedAt: minutesAgo(3), total: 5 },
			}),
		);
		expect(status).toMatchObject({
			failure: { at: minutesAgo(1).toISOString(), code: "access_denied" },
			state: "failed",
		});
	});

	it("reports a run whose worker lease ran out as interrupted", () => {
		const status = sourceStatus(
			input({
				activeRun: {
					leaseExpiresAt: minutesAgo(1),
					recordsDone: 50,
					recordsFrom: 0,
					recordsFromAt: minutesAgo(9),
					recordsTotal: 100,
					startedAt: minutesAgo(9),
				},
			}),
		);
		expect(status).toMatchObject({
			failure: { at: minutesAgo(1).toISOString(), code: "interrupted" },
			state: "failed",
		});
	});

	it("treats finished search work as up to date, keeping failed search updates countable", () => {
		const status = sourceStatus(
			input({
				issues: { pdf_unavailable: 3 },
				lastChange: { records: 14 },
				lastSuccessAt: minutesAgo(2),
				search: { done: 20, startedAt: minutesAgo(3), total: 20 },
				searchFailed: 2,
				searchable: 12_450,
			}),
		);
		expect(status).toMatchObject({
			changed: 14,
			issues: { pdf_unavailable: 3 },
			lastSuccessAt: minutesAgo(2).toISOString(),
			searchFailed: 2,
			searchable: 12_450,
			state: "succeeded",
		});
	});

	it("leaves the change count unknown until a run changes something", () => {
		expect(sourceStatus(input({ lastSuccessAt: minutesAgo(1) })).changed).toBeNull();
	});

	it("shows a run adding PDFs as the PDF step, counting this run's PDFs at its own rate", () => {
		const status = sourceStatus(
			input({
				activeRun: {
					leaseExpiresAt: minutesAgo(-5),
					pdfsMissed: 100,
					recordsDone: 600,
					recordsFrom: 0,
					recordsFromAt: minutesAgo(2),
					recordsTotal: 2_000,
					stage: "pdfs",
					startedAt: minutesAgo(30),
				},
				pdfs: { added: 9_000, missed: 1_000 },
			}),
		);
		expect(status).toMatchObject({
			done: 600,
			minutesLeft: 5,
			pdfs: { added: 500, missed: 100 },
			phase: "pdfs",
			state: "running",
			total: 2_000,
		});
	});

	it("shows the records' search update before their PDFs", () => {
		const status = sourceStatus(
			input({
				activeRun: {
					leaseExpiresAt: minutesAgo(-5),
					pdfsMissed: 0,
					recordsDone: 50,
					recordsFrom: 0,
					recordsFromAt: minutesAgo(1),
					recordsTotal: 2_000,
					stage: "pdfs",
					startedAt: minutesAgo(30),
				},
				search: { done: 400, startedAt: minutesAgo(10), total: 1_000 },
			}),
		);
		expect(status).toMatchObject({ done: 400, phase: "search", state: "running", total: 1_000 });
	});

	it("keeps the PDF stage of a run whose worker lease ran out, after the records' waiting search update", () => {
		const activeRun = {
			leaseExpiresAt: minutesAgo(1),
			recordsDone: 50,
			recordsFrom: 0,
			recordsFromAt: minutesAgo(5),
			recordsTotal: 100,
			stage: "pdfs" as const,
			startedAt: minutesAgo(30),
		};
		expect(sourceStatus(input({ activeRun }))).toMatchObject({ failedIn: "pdfs", state: "failed" });
		expect(
			sourceStatus(input({ activeRun, search: { done: 400, startedAt: minutesAgo(10), total: 1_000 } })),
		).toMatchObject({ phase: "search", state: "running" });
	});

	it("shows the records' waiting search update before a stop while adding PDFs", () => {
		const status = sourceStatus(
			input({
				lastError: { at: minutesAgo(3), code: "internal", details: "Error: storage unavailable", inPdfs: true },
				search: { done: 400, startedAt: minutesAgo(10), total: 1_000 },
			}),
		);
		expect(status).toMatchObject({ phase: "search", state: "running" });
	});

	it("says when a failed run had imported every record and stopped adding PDFs", () => {
		const failure = { at: minutesAgo(3), code: "internal" as const, details: "Error: storage unavailable" };
		expect(sourceStatus(input({ lastError: { ...failure, inPdfs: true } }))).toMatchObject({
			failedIn: "pdfs",
			state: "failed",
		});
		expect(sourceStatus(input({ lastError: failure }))).not.toHaveProperty("failedIn");
	});

	it("is idle before the first import", () => {
		expect(sourceStatus(input()).state).toBe("idle");
	});
});

describe("classifySourceError", () => {
	it.each([
		[new ZoteroApiError("Zotero request failed with 403 Forbidden", 403), "access_denied"],
		[new OpenAlexApiError("OpenAlex works returned 401", 401), "access_denied"],
		[new ZoteroApiError("Zotero request failed with 404 Not Found", 404), "not_found"],
		[new ZoteroApiError("Zotero request failed with 429", 429), "rate_limited"],
		[new OpenAlexApiError("OpenAlex works returned 400", 400), "invalid_query"],
		[new OpenAlexApiError("OpenAlex works request exhausted retries"), "unavailable"],
		[new ZoteroApiError("Zotero request failed with 503", 503), "unavailable"],
		[new SourceCredentialNotFoundError("openalex-teachers"), "missing_key"],
		[new ZoteroSnapshotTooLargeError("snapshot", 250_000, 200_000), "too_large"],
		[new Error("database connection reset"), "internal"],
	] as const)("classifies %s as %s", (error, code) => {
		expect(classifySourceError(error)).toBe(code);
	});
});
