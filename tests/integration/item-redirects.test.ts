import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";
import { Meilisearch } from "meilisearch";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ getDatabaseForConfig: vi.fn() }));

import { getDatabaseForConfig } from "@/db";
import { itemRedirect } from "@/db/schema/tables/itemRedirect";
import { copyMeilisearchRedirects, encodeRedirectId } from "@/lib/item-redirect-copy";
import { readItemRedirect } from "@/lib/item-redirects";

// The database comes from the mocked `getDatabaseForConfig`, so the configuration itself is never read.
const config = {} as Parameters<typeof readItemRedirect>[0];

let client: Meilisearch;
let ownedContainer: string | undefined;

beforeAll(async () => {
	let host = process.env.EVIDENCE_LIBRARY_TEST_MEILI_URL ?? "";
	if (!host) {
		ownedContainer = `item-redirects-${randomUUID()}`;
		// Take a port the machine reports free; rootless Docker daemons don't see each other's bindings.
		const probe = createServer().listen(0, "127.0.0.1");
		await once(probe, "listening");
		const { port } = probe.address() as AddressInfo;
		probe.close();
		execFileSync("docker", ["run", "--detach", "--rm", "--name", ownedContainer, "--publish", `127.0.0.1:${port}:7700`, "--env", "MEILI_NO_ANALYTICS=true", "getmeili/meilisearch:v1.54"]);
		host = `http://127.0.0.1:${port}`;
	}
	client = new Meilisearch({ host, apiKey: process.env.EVIDENCE_LIBRARY_TEST_MEILI_KEY, defaultWaitOptions: { timeout: 30_000 } });
	await vi.waitFor(async () => expect((await client.health()).status).toBe("available"), { timeout: 15_000 });
});

afterAll(() => {
	if (ownedContainer) execFileSync("docker", ["stop", ownedContainer]);
});

async function successful(task: { waitTask: () => Promise<{ status: string }> }) {
	expect((await task.waitTask()).status).toBe("succeeded");
}

it("copies one library's redirects out of Meilisearch, and a second copy changes nothing", async () => {
	await withIsolatedPublicationDatabase(async (database) => {
		vi.mocked(getDatabaseForConfig).mockResolvedValue(database);
		expect(await copyMeilisearchRedirects(client, database, "evidence_library")).toEqual({
			indexFound: false, read: 0, copied: 0, otherLibraries: 0, unreadable: 0,
		});

		await successful(client.createIndex("redirects", { primaryKey: "id" }));
		try {
			await successful(client.index("redirects").addDocuments([
				{ id: encodeRedirectId("evidence_library|OLDKEY01"), value: "NEWKEY01" },
				{ id: encodeRedirectId("evidence_library|OLDKEY02"), value: "NEWKEY02" },
				{ id: encodeRedirectId("other_library|OLDKEY03"), value: "NEWKEY03" },
				{ id: encodeRedirectId("evidence_library|not-a-key"), value: "NEWKEY04" },
				{ id: encodeRedirectId("evidence_library|OLDKEY05"), value: "" },
			]));
			const summary = { indexFound: true, read: 5, copied: 2, otherLibraries: 1, unreadable: 2 };
			expect(await copyMeilisearchRedirects(client, database, "evidence_library")).toEqual(summary);
			expect(await copyMeilisearchRedirects(client, database, "evidence_library")).toEqual(summary);
		} finally {
			await successful(client.deleteIndex("redirects"));
		}

		expect(await database.select().from(itemRedirect).orderBy(itemRedirect.fromKey)).toEqual([
			{ fromKey: "OLDKEY01", toKey: "NEWKEY01" },
			{ fromKey: "OLDKEY02", toKey: "NEWKEY02" },
		]);
		expect(await readItemRedirect(config, "OLDKEY01")).toBe("NEWKEY01");
		expect(await readItemRedirect(config, "OLDKEY03")).toBeNull();
	});
});

it("reads ids from the index's own primary key, across more than one page", async () => {
	await withIsolatedPublicationDatabase(async (database) => {
		await successful(client.createIndex("redirects", { primaryKey: "uid" }));
		try {
			const keys = Array.from({ length: 1_001 }, (_, index) => `OLD${String(index).padStart(5, "0")}`);
			await successful(client.index("redirects").addDocuments([
				...keys.map((key) => ({ uid: encodeRedirectId(`evidence_library|${key}`), value: "NEWKEY01" })),
				// Not text, so no library's id: counted as unreadable rather than as another library's.
				{ uid: 7, value: "NEWKEY02" },
			]));
			expect(await copyMeilisearchRedirects(client, database, "evidence_library")).toEqual({
				indexFound: true, read: 1_002, copied: 1_001, otherLibraries: 0, unreadable: 1,
			});
		} finally {
			await successful(client.deleteIndex("redirects"));
		}
		expect(await database.$count(itemRedirect)).toBe(1_001);
	});
});
