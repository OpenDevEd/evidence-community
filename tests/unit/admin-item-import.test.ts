import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
	adminImportRequestSchema,
	parseDoiList,
} from "@/lib/admin/item-import-contract";
import {
	assignDuplicateStates,
	importDateValue,
	importIdentifiers,
	importPayloadFromZoteroItem,
} from "@/lib/admin/item-import-service";
import { validateNativeItemDraft } from "@/lib/admin/native-item-validation";
import {
	importZoteroBibliography,
	searchZoteroIdentifier,
	ZoteroTranslationError,
} from "@/lib/zotero-translation";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("DOI list parsing", () => {
	it("normalizes doi.org links and plain DOIs and keeps the rest as invalid", () => {
		expect(
			parseDoiList(
				"https://doi.org/10.1000/ABC, 10.1000/abc\n doi:10.5555/xyz;part\nnot-a-doi",
			),
		).toEqual({ dois: ["10.1000/abc", "10.5555/xyz;part"], invalid: ["not-a-doi"] });
	});

	it("keeps an address that names a paper as given, for the import to follow to its DOI", () => {
		expect(parseDoiList("https://dev.openscholar.ai/papers/OS79563844/a-title\nhttps://example.org/page")).toEqual({
			dois: ["https://dev.openscholar.ai/papers/OS79563844/a-title"],
			invalid: ["https://example.org/page"],
		});
	});
});

describe("Zotero import payload", () => {
	it("drops children and bookkeeping, flattens tags, and passes draft validation", () => {
		const payload = importPayloadFromZoteroItem({
			DOI: "10.1000/abc",
			attachments: [{ title: "Full Text PDF" }],
			creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }],
			date: "1843-09-01",
			itemType: "journalArticle",
			key: "ABCD1234",
			notes: [{ note: "hello" }],
			publicationTitle: "Notes",
			relations: {},
			tags: [{ tag: "math", type: 1 }],
			title: "Sketch of the Analytical Engine",
			version: 0,
		});

		expect(payload).not.toHaveProperty("attachments");
		expect(payload).not.toHaveProperty("notes");
		expect(payload).not.toHaveProperty("key");
		expect(payload).not.toHaveProperty("version");
		expect(payload.tags).toEqual(["math"]);
		expect(payload.collections).toEqual([]);

		const validated = validateNativeItemDraft(payload, { allowIncompleteCreators: true });
		expect(validated.item.itemType).toBe("JournalArticle");
		expect(validated.item.DOI).toBe("10.1000/abc");
		expect(validated.item.creators).toEqual([
			{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" },
		]);
	});
});

describe("translator dates", () => {
	it("keeps valid dates, converts US dates, and falls back to the year", () => {
		expect(importDateValue("2013-08-01")).toBe("2013-08-01");
		expect(importDateValue("2013")).toBe("2013");
		expect(importDateValue("8/1/2013")).toBe("2013-08-01");
		expect(importDateValue("8/2013")).toBe("2013");
		expect(importDateValue("August 2013")).toBe("2013");
		expect(importDateValue("2/30/2013")).toBe("2013");
		expect(importDateValue("n.d.")).toBe("n.d.");
	});
});

describe("duplicate detection", () => {
	const ready = (identifiers: Partial<ReturnType<typeof importIdentifiers>>) => ({
		identifiers: { doi: null, isbn: null, pmid: null, ...identifiers },
		state: "ready" as const,
	});

	it("marks exact identifier matches as existing and later repeats within the import", () => {
		const existing = {
			doi: new Map([["10.1000/abc", "EXIST001"]]),
			isbn: new Map<string, string>(),
			pmid: new Map([["123", "EXIST002"]]),
		};
		const states = assignDuplicateStates(
			[
				ready({ doi: "10.1000/abc", isbn: "9780000000018" }),
				ready({ pmid: "123" }),
				ready({ isbn: "9780000000018" }),
				ready({ doi: "10.1000/new" }),
				ready({ doi: "10.1000/new", isbn: "9780000000001" }),
				ready({ isbn: "9780000000001" }),
				ready({}),
				ready({}),
			],
			existing,
		).map(({ state, ...rest }) => ({ state, existingKey: (rest as { existingKey?: string }).existingKey }));

		expect(states).toEqual([
			{ existingKey: "EXIST001", state: "existing" },
			{ existingKey: "EXIST002", state: "existing" },
			{ existingKey: undefined, state: "repeated" },
			{ existingKey: undefined, state: "ready" },
			{ existingKey: undefined, state: "repeated" },
			{ existingKey: undefined, state: "repeated" },
			{ existingKey: undefined, state: "ready" },
			{ existingKey: undefined, state: "ready" },
		]);
	});

	it("compares ISBNs and PMIDs without punctuation and DOIs without case", () => {
		expect(importIdentifiers({ DOI: "https://doi.org/10.1000/ABC", ISBN: "978-0-00-000000-1", PMID: "PMID: 42" }))
			.toEqual({ doi: "10.1000/abc", isbn: "9780000000001", pmid: "42" });
	});
});

describe("import commit contract", () => {
	it("rejects more than 500 records before anything is created", () => {
		const records = Array.from({ length: 501 }, (_, index) => ({
			id: String(index),
			method: "file",
			payload: { itemType: "book" },
		}));
		expect(
			adminImportRequestSchema.safeParse({
				action: "commit",
				importId: "c8df1386-3420-4f12-8c20-7fb1c31ae0ad",
				records,
			}).success,
		).toBe(false);
		expect(
			adminImportRequestSchema.safeParse({
				action: "commit",
				importId: "c8df1386-3420-4f12-8c20-7fb1c31ae0ad",
				records: records.slice(0, 500),
			}).success,
		).toBe(true);
	});
});

describe("translation server import endpoints", () => {
	it("posts identifiers and files as plain text to /search and /import", async () => {
		const fetchTranslation = vi
			.fn()
			.mockResolvedValueOnce(Response.json([{ itemType: "journalArticle", title: "Found" }]))
			.mockResolvedValueOnce(Response.json([{ itemType: "book", title: "Parsed" }, "junk"]));
		vi.stubGlobal("fetch", fetchTranslation);

		await expect(searchZoteroIdentifier("10.1000/abc", "http://translation:1969/base/")).resolves.toEqual([
			{ itemType: "journalArticle", title: "Found" },
		]);
		await expect(importZoteroBibliography("TY  - JOUR\nER  -", "http://translation:1969/base/")).resolves.toEqual([
			{ itemType: "book", title: "Parsed" },
		]);

		expect(String(fetchTranslation.mock.calls[0]?.[0])).toBe("http://translation:1969/base/search");
		expect(fetchTranslation.mock.calls[0]?.[1]).toMatchObject({
			body: "10.1000/abc",
			headers: { "Content-Type": "text/plain" },
			method: "POST",
		});
		expect(String(fetchTranslation.mock.calls[1]?.[0])).toBe("http://translation:1969/base/import");
		expect(fetchTranslation.mock.calls[1]?.[1]).toMatchObject({ body: "TY  - JOUR\nER  -" });
	});

	it("reports a failed lookup as a translation error with its status", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("No translators", { status: 501 })));
		await expect(searchZoteroIdentifier("10.1000/none", "http://translation:1969")).rejects.toMatchObject({
			code: "TRANSLATION_REQUEST_FAILED",
			name: "ZoteroTranslationError",
			status: 501,
		} satisfies Partial<ZoteroTranslationError>);
	});
});
