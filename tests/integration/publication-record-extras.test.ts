import assert from "node:assert/strict";
import { it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadPublicationRecordExtras } from "../../src/lib/publication/record-extras";
import { readPublicationRepositorySnapshot } from "../../src/lib/publication/repository";
import { publicationTestConfig } from "../fixtures/publication-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

// A record imported from OpenAlex keeps only institution names on its creators; the library keeps each name's OpenAlex
// ID and country apart. A record it cites keeps its DOI only in an attachment tagged `_r:doi`; one related to it has
// only the DOI Zenodo minted for it.
it("finds a named institution's ROR and country, a cited record's DOI in its tagged attachment, and a related record's minted one", async () => {
	await withIsolatedPublicationDatabase(async (database, client) => {
		for (const key of ["PUBEXTAA", "CITEDAAA", "CITEDATT", "MINTEDAA"]) {
			await client.query(`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'native', $1)`, [key]);
		}
		await client.query(
			`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision", "title", "date", "creators", "deleted")
			 VALUES ('PUBEXTAA', 'native', 'PUBEXTAA', 'Report', 1, 'Record with extras', '2026-08-13', $1::jsonb, 0),
			        ('CITEDAAA', 'native', 'CITEDAAA', 'Report', 1, 'Cited record', '2020', '[]'::jsonb, 0),
			        ('MINTEDAA', 'native', 'MINTEDAA', 'Report', 1, 'Related record', '2021', '[]'::jsonb, 0)`,
			[JSON.stringify([{ creatorType: "author", firstName: "Ada", lastName: "Lovelace", institutions: [{ display_name: "University of Rwanda" }] }])],
		);
		await client.query(
			`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "parentItem", "revision", "title", "url", "deleted")
			 VALUES ('CITEDATT', 'native', 'CITEDATT', 'Attachment', 'CITEDAAA', 1, 'DOI', 'https://doi.org/10.1000/cited.1', 0)`,
		);
		await client.query(`INSERT INTO "tag" ("name") VALUES ('_r:doi')`);
		await client.query(`INSERT INTO "itemToTag" ("itemKey", "tagName") VALUES ('CITEDATT', '_r:doi')`);
		await client.query(`INSERT INTO "itemLink" ("fromKey", "toKey", "kind", "origin") VALUES ('PUBEXTAA', 'CITEDAAA', 'cites', 'manual'), ('MINTEDAA', 'PUBEXTAA', 'related', 'manual')`);
		await client.query(
			`INSERT INTO "publicationTarget" ("itemKey", "provider", "environment", "identifierPolicy", "requestedBy") VALUES ('MINTEDAA', 'zenodo', 'sandbox', 'mint-zenodo', 'test')`,
		);
		await client.query(
			`INSERT INTO "publicationIdentifier" ("itemKey", "registrar", "environment", "role", "doi", "ownership", "lifecycle", "verifiedAt")
			 VALUES ('MINTEDAA', 'zenodo', 'sandbox', 'version', '10.5072/zenodo.123', 'managed', 'verified', now())`,
		);
		await client.query(
			`INSERT INTO "institutionCountry" ("nameKey", "countryCode", "openalexId") VALUES ('university of rwanda', 'RW', 'https://openalex.org/I4210087849')`,
		);
		const asked: string[] = [];
		const openAlex = (async (url: URL | RequestInfo) => {
			asked.push(String(url));
			return Response.json({ results: [{ id: "https://openalex.org/I4210087849", ids: { ror: "https://ror.org/00286hs46" } }] });
		}) as typeof fetch;

		const snapshot = await readPublicationRepositorySnapshot(database, "PUBEXTAA", "test");
		const extras = await loadPublicationRecordExtras(database, snapshot, publicationTestConfig(), openAlex);

		assert.deepEqual(extras.institutions, { "university of rwanda": { country: "RW", ror: "https://ror.org/00286hs46" } });
		assert.match(asked.join(), /filter=openalex%3AI4210087849/u);
		assert.deepEqual([...extras.links].sort((a, b) => a.key.localeCompare(b.key)), [
			{ kind: "cites", key: "CITEDAAA", doi: "10.1000/cited.1" },
			{ kind: "related", key: "MINTEDAA", doi: "10.5072/zenodo.123" },
		]);
	});
});
