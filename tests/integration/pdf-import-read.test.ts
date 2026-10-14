import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MockLanguageModelV3 } from "ai/test";

import { libraryConfigSchema } from "../../src/config/library-config/schema";
import { reserveItemIdentity } from "../../src/db/record-identity";
import { item } from "../../src/db/schema/tables/item";
import { createNativeCollection } from "../../src/lib/admin/native-collection-service";
import { createNativeItemDraft } from "../../src/lib/admin/native-item-service";
import { readImportPdf } from "../../src/lib/admin/pdf-import";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { createPdf } from "../helpers/file-storage";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

// The model is the outside service: a script stands in for it, and the read's tools run for real.
const model = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../../src/lib/ai/model-resolution", () => ({ resolveAIModel: () => ({ model: model.current, modelId: "mock-model", provider: "openrouter" }) }));

const base = libraryConfigSchema.parse({ ...maximalLibraryConfig, sources: [] });
const config = { ...base, ai: { ...base.ai, providers: [{ ...base.ai.providers[0]!, defaultModel: "mock-model", enabled: true }] }, topics: { ...base.topics, enabled: false } };
const EDITOR = "user_acceptance_admin";
const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 10, text: 10, reasoning: 0 } };

afterEach(() => vi.unstubAllGlobals());

test("links only what the read's own searches found, and leaves country focus automatic", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const themes = await createNativeCollection(db, { name: "Themes", parentCollection: null });
		const gender = await createNativeCollection(db, { name: "Gender Equality", parentCollection: themes.key });
		const work = await createNativeCollection(db, { name: "_work", parentCollection: null });
		const hidden = await createNativeCollection(db, { name: "Batch 1", parentCollection: work.key });
		const publishedKey = await reserveItemIdentity(db, { sourceConnectionKey: "native" });
		await db.insert(item).values({ DOI: "10.1234/published", itemType: "JournalArticle", key: publishedKey, sourceConnectionKey: "native", sourceRecordKey: publishedKey, title: "A published study" });
		await createNativeItemDraft(db, { DOI: "10.1234/draft", itemType: "Report", title: "A draft never published" });

		// OpenScholar's author search: it must say who asks, and it knows one Ada Lovelace.
		const searches: unknown[] = [];
		vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body));
			searches.push(body);
			const profile = { affiliation: "University of London", bio: "", headline: "", id: "profile_found", linkedin: "", name: "Ada Lovelace", openalex: "", orcid: "", photo: null, revision: 1, website: "" };
			return Response.json({ continueCursor: null, isDone: true, profiles: body.clerkUserId ? [profile] : [] });
		});

		const reading = {
			citedDois: ["https://doi.org/10.1234/PUBLISHED", "10.1234/draft", "10.1234/unknown"],
			checks: [],
			collections: [
				{ key: gender.key, reason: "It is about gender." },
				{ key: hidden.key, reason: "Never shown by the tool." },
			],
			record: {
				creators: [
					{ affiliations: ["University of London"], creatorType: "author", firstName: "Ada", lastName: "Lovelace", profileId: "profile_found" },
					{ affiliations: [], creatorType: "author", firstName: "Charles", lastName: "Babbage", profileId: "profile_invented" },
				],
				fields: [{ field: "language", value: "English" }],
				itemType: "report",
				tags: ["girls' education"],
				title: "Girls' learning in Sierra Leone",
			},
			suggestions: [],
			topics: [],
		};
		const steps = [
			[
				{ input: JSON.stringify({ cursor: "", parent: "", query: "" }), toolName: "searchCollections" },
				{ input: JSON.stringify({ name: "Ada Lovelace" }), toolName: "searchAuthorProfiles" },
			],
			[{ input: JSON.stringify({ cursor: "", parent: themes.key, query: "" }), toolName: "searchCollections" }],
		];
		let call = 0;
		model.current = new MockLanguageModelV3({
			doGenerate: async () => {
				const step = steps[call++];
				if (step) return { content: step.map((part, index) => ({ type: "tool-call" as const, toolCallId: `call-${call}-${index}`, ...part })), finishReason: { raw: "tool_calls", unified: "tool-calls" as const }, usage, warnings: [] };
				return { content: [{ type: "text" as const, text: JSON.stringify(reading) }], finishReason: { raw: "stop", unified: "stop" as const }, usage, warnings: [] };
			},
		});

		const bytes = await createPdf("Girls' learning in Sierra Leone");
		const pdf = { properties: { authors: [], date: "", doi: "", isbn: "", issn: "", issue: "", keywords: [], language: "", pages: "", publicationTitle: "", publisher: "", rights: "", seriesNumber: "", seriesTitle: "", subject: "", title: "", volume: "" }, standards: { pdfa: "", pdfua: "", tagged: false }, writable: true as const };
		const result = await readImportPdf({ clerkUserId: EDITOR, config, database: db }, { bytes, checks: [], filename: "report.pdf", instructions: "", pdf });

		expect(searches).toEqual([expect.objectContaining({ clerkUserId: EDITOR, operation: "search", search: "Ada Lovelace" })]);
		// A profile counts only when a search returned it, and links as an editor links one: under the profile's name.
		expect(result.zoteroItem.creators).toEqual([
			{ authorProfileId: "profile_found", creatorType: "author", firstName: "", institutions: [{ display_name: "University of London" }], lastName: "Ada Lovelace" },
			{ creatorType: "author", firstName: "Charles", lastName: "Babbage" },
		]);
		// A collection counts only when the tool showed it, with where it sits.
		expect(result.collections).toEqual([{ id: gender.key, name: "Gender Equality", path: ["Themes"], reason: "It is about gender." }]);
		// Cited records are the published ones the reference list names by DOI, under the library's own title.
		expect(result.cites).toEqual([{ key: publishedKey, title: "A published study" }]);
		expect(result.zoteroItem.links).toEqual({ cites: [publishedKey] });
		expect(result.zoteroItem).not.toHaveProperty("countryFocus");
		expect(result.zoteroItem).toMatchObject({ itemType: "report", language: "English", tags: [{ tag: "girls' education" }] });
	});
});
