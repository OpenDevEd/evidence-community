import { describe, expect, it } from "vitest";

import type { SourceConnection } from "@/lib/source-ingestion/adapter";
import { openAlexFullScanDue, openAlexSyncIsDue } from "@/lib/source-ingestion/openalex/sync";

const config = {
	name: "AI in education",
	searchUrl: "/results/saved-search-1",
	approvedQuery: { version: "v1", approvedAt: "2026-09-24T10:00:00Z", query: { search: "AI in education" } },
	downloadPdfs: false,
};

const cursor = (overrides: Record<string, unknown> = {}) => ({
	queryVersion: "v1",
	startedAt: "2026-09-28T02:00:30.000Z",
	nextCursor: null,
	imported: 10,
	completedAt: "2026-09-28T02:05:00.000Z",
	mode: "incremental",
	reconciledAt: "2026-09-25T02:10:00.000Z",
	updatedSince: "2026-09-26",
	incrementalAvailable: true,
	pdfsAdded: false,
	...overrides,
});

const connection = (syncCursor: Record<string, unknown>, approvedVersion = "v1") =>
	({
		key: "oa",
		provider: "openalex",
		config: { ...config, approvedQuery: { ...config.approvedQuery, version: approvedVersion } },
		syncCursor,
	}) as unknown as SourceConnection;

// The regular sweep runs every minute; OpenAlex sources refresh once a night at 02:00 UTC.
describe("openAlexSyncIsDue", () => {
	it("runs a source that never ran, stopped part-way, or has a new query straight away", () => {
		const midday = new Date("2026-09-28T12:00:00Z");
		expect(openAlexSyncIsDue(connection({}), midday)).toBe(true);
		expect(openAlexSyncIsDue(connection(cursor({ completedAt: null, nextCursor: "page-3" })), midday)).toBe(true);
		expect(openAlexSyncIsDue(connection(cursor(), "v2"), midday)).toBe(true);
	});

	it("waits until the next night after tonight's refresh", () => {
		expect(openAlexSyncIsDue(connection(cursor()), new Date("2026-09-28T12:00:00Z"))).toBe(false);
		expect(openAlexSyncIsDue(connection(cursor()), new Date("2026-09-29T01:59:00Z"))).toBe(false);
		expect(openAlexSyncIsDue(connection(cursor()), new Date("2026-09-29T02:00:00Z"))).toBe(true);
	});

	it("refreshes once after the night's time when the last run was the day before", () => {
		const yesterday = cursor({ startedAt: "2026-09-27T02:00:30.000Z", completedAt: "2026-09-27T02:05:00.000Z" });
		expect(openAlexSyncIsDue(connection(yesterday), new Date("2026-09-28T01:00:00Z"))).toBe(false);
		expect(openAlexSyncIsDue(connection(yesterday), new Date("2026-09-28T03:00:00Z"))).toBe(true);
	});

	// An import that runs for days is not followed straight away by a refresh it has already covered.
	it("waits for the next night after a long run that finished after tonight's time", () => {
		const long = cursor({ mode: "full", startedAt: "2026-09-27T10:00:00.000Z", completedAt: "2026-09-28T12:55:00.000Z" });
		expect(openAlexSyncIsDue(connection(long), new Date("2026-09-28T12:56:00Z"))).toBe(false);
		expect(openAlexSyncIsDue(connection(long), new Date("2026-09-29T02:00:00Z"))).toBe(true);
	});

	// A full scan finishes after 02:00, so counting hours would push the next one to the eighth night.
	it("runs the full rescan on the seventh night after the last one finished", () => {
		const finished = "2026-09-21T02:40:00.000Z";
		expect(openAlexFullScanDue(finished, new Date("2026-09-27T02:00:30Z"))).toBe(false);
		expect(openAlexFullScanDue(finished, new Date("2026-09-28T02:00:30Z"))).toBe(true);
	});
});

describe("openAlexSyncIsDue with PDFs", () => {
	const withPdfs = (syncCursor: Record<string, unknown>) =>
		({ ...connection(syncCursor), config: { ...config, downloadPdfs: true } }) as unknown as SourceConnection;
	const midday = new Date("2026-09-28T12:00:00Z");

	it("runs a source straight away when PDFs were turned on after its last complete run", () => {
		expect(openAlexSyncIsDue(withPdfs(cursor()), midday)).toBe(true);
	});

	it("waits for the night once a run has added the PDFs", () => {
		expect(openAlexSyncIsDue(withPdfs(cursor({ stage: "pdfs", pdfs: { done: 5, missed: 1, total: 5 } })), midday)).toBe(false);
	});

	it("runs a source straight away when PDFs were turned off after a run added them, then waits", () => {
		const added = cursor({ stage: "pdfs", pdfs: { done: 5, missed: 1, total: 5 } });
		expect(openAlexSyncIsDue(connection(added), midday)).toBe(true);
		// The run that takes them down ends on the records stage.
		expect(openAlexSyncIsDue(connection(cursor({ mode: "full" })), midday)).toBe(false);
	});

	it("scans once in full a source whose cursor predates the record of added PDFs", () => {
		expect(openAlexSyncIsDue(connection(cursor({ pdfsAdded: undefined })), midday)).toBe(true);
	});
});
