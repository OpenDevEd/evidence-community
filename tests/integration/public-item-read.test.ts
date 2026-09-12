import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions", () => ({ areLinksValid: vi.fn() }));
vi.mock("@/db", () => ({ getDatabaseForConfig: vi.fn() }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: vi.fn() }));
vi.mock("@/app/api/cache", () => ({
	getCachedItem: async (key: string) => (await import("@/app/api/item/[key]/route")).getItem(key),
	getCachedCollections: async () => [],
}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));
vi.mock("@/i18n/server", () => ({ getRuntimeRequestLocale: async () => "en-GB" }));

import { getDatabaseForConfig } from "@/db";
import { getLibraryConfig } from "@/config/library-config/server";
import { GET } from "@/app/api/item/[key]/route";
import { GET as readCitation } from "@/app/api/item/[key]/citation/route";
import { readCitationRecordsPage } from "@/lib/library-export-records";
import { getPublicItemCard, getPublicItemCards } from "@/lib/public-item-card";
import { publicationTestConfig } from "../fixtures/publication-config";
import { getPublicItemLinksForKeys } from "@/lib/links/item-links";
import { createNativeCollection } from "@/lib/admin/native-collection-service";
import { createNativeItemDraft } from "@/lib/admin/native-item-service";

const config = libraryConfigSchema.parse(maximalLibraryConfig);
config.content.tags.hidden = ["hidden"];

afterEach(() => vi.unstubAllGlobals());

// Only external citation services are replaced; the source record and renderer are real.
function stubCitationServices() {
	vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
		if (String(url).includes("/export?format=csljson")) {
			const [record] = JSON.parse(String(init?.body));
			return Response.json([{ id: "PUBAAAAA", type: "report", title: record.title, DOI: record.DOI }]);
		}
		if (String(url).endsWith("apa.csl")) {
			return new Response('<style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text"><info><title>Test title citation</title><id>https://example.org/test</id></info><citation><layout><text variable="title"/></layout></citation><bibliography><layout><text variable="title"/><text variable="DOI" prefix=" "/></layout></bibliography></style>');
		}
		if (String(url).includes("locales-en-GB.xml")) {
			return new Response('<locale xmlns="http://purl.org/net/xbiblio/csl" xml:lang="en-GB"><terms/></locale>');
		}
		throw new Error(`Unexpected external request: ${url}`);
	}));
}

async function citation(key: string) {
	const response = await readCitation(new NextRequest(`https://library.example.org/api/item/${key}/citation`), { params: Promise.resolve({ key }) });
	expect(response.headers.get("cache-control")).toBe("no-store");
	return (await response.json()).citation;
}

function read(key: string) {
	return GET(new NextRequest(`https://library.example.org/api/item/${key}`), { params: Promise.resolve({ key }) });
}

it("reads committed publications before indexing, and immediately respects edits, removal and hidden records", async () => {
	stubCitationServices();
	await withIsolatedPublicationDatabase(async (database, client) => {
		vi.mocked(getDatabaseForConfig).mockResolvedValue(database);
		vi.mocked(getLibraryConfig).mockResolvedValue(config);
		const draft = await createNativeItemDraft(database, { itemType: "Report", title: "Private working draft" });
		expect((await read(draft.itemKey)).status).toBe(404);
		const rows = [
			["PUBAAAAA", "Report", null, 0, "Published title"],
			["CHILDDDD", "Attachment", "PUBAAAAA", 0, "Published PDF"],
			["SECRETAA", "Attachment", "PUBAAAAA", 0, "Hidden PDF"],
			["DELETEDD", "Attachment", "PUBAAAAA", 1, "Removed PDF"],
			["HIDDENNN", "Report", null, 0, "Hidden publication"],
		];
		for (const [key, itemType, parentItem, deleted, title] of rows) {
			await client.query('INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, \'native\', $1)', [key]);
			await client.query('INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "parentItem", "deleted", "title", "fullTextPDF") VALUES ($1, \'native\', $1, $2, $3, $4, $5, $6)', [key, itemType, parentItem, deleted, title, parentItem ? `${title} text` : null]);
		}
		await client.query('INSERT INTO "tag" ("name") VALUES (\'Hidden\')');
		await client.query('INSERT INTO "itemToTag" ("itemKey", "tagName") VALUES (\'HIDDENNN\', \'Hidden\'), (\'SECRETAA\', \'Hidden\')');
		await client.query(`INSERT INTO tag (name) VALUES ('_r:doi')`);
		await client.query(`INSERT INTO "itemToTag" ("itemKey", "tagName") VALUES ('CHILDDDD', '_r:doi'), ('SECRETAA', '_r:doi'), ('DELETEDD', '_r:doi')`);
		await client.query(`UPDATE item SET url = 'https://doi.org/10.5555/' || lower(key) WHERE "parentItem" = 'PUBAAAAA'`);
		await client.query('INSERT INTO "itemLink" ("fromKey", "toKey", "kind", "origin") VALUES (\'PUBAAAAA\', \'HIDDENNN\', \'related\', \'manual\')');
		const root = await createNativeCollection(database, { name: "Root", parentCollection: null });
		const child = await createNativeCollection(database, { name: "Child", parentCollection: root.key });
		await createNativeCollection(database, { name: "Unrelated", parentCollection: null });
		await client.query('INSERT INTO "itemToCollection" ("itemKey", "collectionKey") VALUES ($1, $2)', ["PUBAAAAA", child.key]);
		await client.query('INSERT INTO "itemInstitution" ("itemKey", "institutionName") VALUES (\'PUBAAAAA\', \'Learning Lab\')');
		const response = await read("PUBAAAAA");
		expect(response.status).toBe(200);
		const publication = (await response.json()).item;
		expect(publication.title).toBe("Published title");
		expect(publication.DOI).toBe("10.5555/childddd");
		expect(await citation("PUBAAAAA")).toContain("10.5555/childddd");
		expect((await getPublicItemCards(database, ["PUBAAAAA", "HIDDENNN", "CHILDDDD"], config)).map(card => [card.key, card.DOI])).toEqual([["PUBAAAAA", "10.5555/childddd"]]);
		expect((await readCitationRecordsPage(config, null, 10)).map(record => [record.key, record.DOI])).toEqual([["PUBAAAAA", "10.5555/childddd"]]);
		expect(publication.collections).toEqual([child.key]);
		expect(publication.collectionsAncestry).toEqual([child.key, root.key].sort());
		expect(await citation("PUBAAAAA")).toContain("Published title");
		const links = await getPublicItemLinksForKeys(database, ["PUBAAAAA", "HIDDENNN"], { hiddenTags: ["hidden"] });
		expect(links.get("PUBAAAAA")?.related ?? []).toEqual([]);
		expect(links.get("HIDDENNN")?.related).toEqual(["PUBAAAAA"]);
		expect(publication.institution).toEqual(["Learning Lab"]);
		expect(publication.links).toEqual({ cites: [], citedBy: [], related: [] });
		expect(publication.attachmentsData.map((attachment: { key: string }) => attachment.key)).toEqual(["CHILDDDD"]);
		expect(publication.fullTextPDFs).toEqual([{ key: "CHILDDDD", fullTextPDF: [{ page: 1, text: "Published PDF text" }] }]);
		expect(response.headers.get("cache-control")).toBe("no-store");
		for (const key of ["HIDDENNN", "CHILDDDD", "DELETEDD", "MISSINGG"]) {
			const missing = await read(key);
			expect(missing.status).toBe(404);
			expect((await missing.json()).item).toBeNull();
			expect(await citation(key)).toBeNull();
		}
		await client.query('UPDATE "item" SET "title" = \'Revised title\', "revision" = "revision" + 1 WHERE "key" = \'PUBAAAAA\'');
		expect((await (await read("PUBAAAAA")).json()).item.title).toBe("Revised title");
		expect(await citation("PUBAAAAA")).toContain("Revised title");
		await client.query('UPDATE "item" SET "deleted" = 1 WHERE "key" = \'PUBAAAAA\'');
		expect((await read("PUBAAAAA")).status).toBe(404);
		expect(await citation("PUBAAAAA")).toBeNull();
	});
}, 120_000);

it("reports an unavailable database as a retryable failure instead of a missing publication", async () => {
	vi.mocked(getLibraryConfig).mockResolvedValue(config);
	vi.mocked(getDatabaseForConfig).mockRejectedValue(new Error("Database unavailable"));
	const response = await read("PUBAAAAA");
	expect(response.status).toBe(503);
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect((await read("invalid")).status).toBe(400);
	const citationResponse = await readCitation(new NextRequest("https://library.example.org/api/item/PUBAAAAA/citation"), { params: Promise.resolve({ key: "PUBAAAAA" }) });
	expect(citationResponse.status).toBe(503);
	expect(citationResponse.headers.get("cache-control")).toBe("no-store");
});

it("uses current registered identifiers across public records, citations, cards and library exports", async () => {
	stubCitationServices();
	await withIsolatedPublicationDatabase(async (database, client) => {
		const config = publicationTestConfig();
		vi.mocked(getDatabaseForConfig).mockResolvedValue(database);
		vi.mocked(getLibraryConfig).mockResolvedValue(config);
		for (const [key, doi] of [["ZENDAAAA", null], ["RESERVAA", null], ["IMPRTAAA", "10.5555/external"]]) {
			await client.query('INSERT INTO "itemIdentity" (key, "sourceConnectionKey", "sourceRecordKey") VALUES ($1, \'native\', $1)', [key]);
			await client.query('INSERT INTO item (key, "sourceConnectionKey", "sourceRecordKey", "itemType", title, "DOI") VALUES ($1, \'native\', $1, \'Report\', $1, $2)', [key, doi]);
		}
		await client.query(`INSERT INTO "publicationTarget" ("itemKey", provider, environment, "identifierPolicy", "requestedBy") VALUES
			('ZENDAAAA', 'zenodo', 'sandbox', 'mint-zenodo', 'qa'),
			('ZENDAAAA', 'zenodo', 'production', 'mint-zenodo', 'qa'),
			('RESERVAA', 'crossref', 'test', null, 'qa')`);
		await client.query(`INSERT INTO "publicationIdentifier" ("itemKey", registrar, environment, role, doi, ownership, lifecycle, "isCurrent", "verifiedAt") VALUES
			('ZENDAAAA', 'zenodo', 'sandbox', 'version', '10.5072/zenodo.700002', 'managed', 'verified', true, now()),
			('ZENDAAAA', 'zenodo', 'sandbox', 'version', '10.5072/zenodo.700000', 'managed', 'verified', false, now()),
			('ZENDAAAA', 'zenodo', 'sandbox', 'concept', '10.5072/zenodo.700001', 'managed', 'verified', true, now()),
			('ZENDAAAA', 'zenodo', 'production', 'version', '10.5281/zenodo.900002', 'managed', 'verified', true, now()),
			('RESERVAA', 'crossref', 'test', 'primary', '10.5555/private-reservation', 'managed', 'reserved', true, null)`);
		const doi = "10.5072/zenodo.700002";
		expect((await (await read("ZENDAAAA")).json()).item.DOI).toBe(doi);
		expect(await citation("ZENDAAAA")).toContain(doi);
		expect((await getPublicItemCard(database, "ZENDAAAA", config))?.DOI).toBe(doi);
		const exported = await readCitationRecordsPage(config, null, 10);
		expect(exported.map((record) => [record.key, record.DOI])).toEqual([["IMPRTAAA", "10.5555/external"], ["RESERVAA", null], ["ZENDAAAA", doi]]);
		const reserved = (await (await read("RESERVAA")).json()).item;
		expect(reserved.DOI).toBeNull();
		expect(reserved.publicationIdentifiers).toBeUndefined();
		expect(await citation("RESERVAA")).not.toContain("private-reservation");
		// Editor activation copies an allocated DOI onto the approved record.
		// Keep its reserved label until the provider confirms registration.
		await client.query('UPDATE item SET "DOI" = \'10.5555/private-reservation\' WHERE key = \'RESERVAA\'');
		const activated = (await (await read("RESERVAA")).json()).item;
		expect(activated.publicationIdentifiers.crossref).toEqual({
			doi: "10.5555/private-reservation", lifecycle: "reserved",
		});
		await client.query('UPDATE item SET deleted = 1 WHERE key = \'ZENDAAAA\'');
		expect((await read("ZENDAAAA")).status).toBe(404);
		expect(await getPublicItemCard(database, "ZENDAAAA", config)).toBeNull();
		expect((await readCitationRecordsPage(config, null, 10)).map((record) => record.key)).toEqual(["IMPRTAAA", "RESERVAA"]);
	});
}, 120_000);
