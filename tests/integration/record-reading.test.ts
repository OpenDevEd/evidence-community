import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { libraryConfigSchema } from "@/config/library-config/schema";
import { itemGrade, itemReading, itemReadingQueue, readingSpend } from "@/db/schema/readings";
import { runReadingCycle } from "@/lib/readings/worker";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

type Client = { query: (text: string, values?: unknown[]) => Promise<unknown> };

const source = maximalLibraryConfig.sources[0];
const configWith = (subject: string) => libraryConfigSchema.parse({
	...maximalLibraryConfig,
	ai: { ...maximalLibraryConfig.ai, providers: [...maximalLibraryConfig.ai.providers, { provider: "openrouter", enabled: true, apiKey: "library-openrouter-key", models: ["openai/gpt-6-luna"], defaultModel: "openai/gpt-6-luna" }] },
	sources: [{ ...source, screening: { enabled: true, subject } }],
});

/** A record of the screening source, published: its outbox row is what queues it. */
async function publish(client: Client, key: string, title: string, abstract: string | null, revision = 1) {
	await client.query(`INSERT INTO "sourceConnection" (key, provider, "scopeKind", "externalScopeKey") VALUES ($1, 'zotero', 'group', '6632364') ON CONFLICT DO NOTHING`, [source.key]);
	await client.query(
		`INSERT INTO "itemIdentity" (key, "sourceConnectionKey", "sourceRecordKey") VALUES ($1, $2, $1) ON CONFLICT DO NOTHING`, [key, source.key]);
	await client.query(
		`INSERT INTO item (key, "sourceConnectionKey", "sourceRecordKey", "itemType", title, "abstractNote", revision) VALUES ($1, $2, $1, 'JournalArticle', $3, $4, $5)
		 ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, "abstractNote" = EXCLUDED."abstractNote", revision = EXCLUDED.revision`, [key, source.key, title, abstract, revision]);
	await client.query(`INSERT INTO "itemSourceLink" ("itemKey", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, $2, $1) ON CONFLICT DO NOTHING`, [key, source.key]);
	await client.query(`INSERT INTO outbox ("entityType", "entityKey", operation, revision) VALUES ('item', $1, 'upsert', $2)`, [key, revision]);
}

/** Stands in for OpenRouter's Decisions API: answers every question asked, and keeps what each call asked. */
function jev(answer: (questions: string[]) => Response) {
	const asked: string[][] = [];
	const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
		const questions = Object.keys((JSON.parse(String(init?.body)) as { questions: Record<string, unknown> }).questions);
		asked.push(questions);
		return answer(questions);
	});
	return { asked, request: request as unknown as typeof fetch };
}
const ANSWERS: Record<string, unknown> = {
	type: { type: "choice", choice: "meta-analysis", confidence: 0.91 },
	pooled: { type: "noul", noul: 0.88 },
	region: { type: "choice", choice: "sub-saharan-africa", confidence: 0.8 },
	effects: { type: "noul", noul: 0.93 },
	grade_0: { type: "score", score: 2.8 },
};
const answering = (questions: string[]) => Response.json({ model: "typesafe/jev-1.13", answers: Object.fromEntries(questions.map((id) => [id, ANSWERS[id]])), usage: { input_tokens: 1800, cost: 0.0001 } });

it("reads each published record once, again only when its text or its source's subject changes, and keeps a failed one queued", async () => {
	await withIsolatedPublicationDatabase(async (db, client) => {
		await publish(client, "METAAAA2", "Drought and maize: a meta-analysis", "We pooled 40 trials across Malawi and Kenya.");
		expect((await db.select().from(itemReadingQueue)).map((job) => job.itemKey)).toEqual(["METAAAA2"]);

		const first = jev(answering);
		await runReadingCycle(db, configWith("Climate adaptation in farming"), undefined, first.request);
		expect(first.asked).toEqual([["type", "pooled", "region", "effects", "grade_0"]]);
		expect(await db.select({ type: itemReading.studyType, typedBy: itemReading.typedBy, region: itemReading.region, input: itemReading.input }).from(itemReading))
			.toEqual([{ type: "meta-analysis", typedBy: "ai", region: "sub-saharan-africa", input: "abstract" }]);
		expect((await db.select({ score: itemGrade.score }).from(itemGrade)).map((grade) => grade.score)).toEqual([2.8]);
		expect((await db.select({ reads: readingSpend.reads }).from(readingSpend))[0]?.reads).toBe(1);

		// Published again with the same text: queued, read for free.
		await publish(client, "METAAAA2", "Drought and maize: a meta-analysis", "We pooled 40 trials across Malawi and Kenya.", 2);
		const unchanged = jev(answering);
		await runReadingCycle(db, configWith("Climate adaptation in farming"), undefined, unchanged.request);
		expect(unchanged.asked).toEqual([]);

		// A new subject asks only the grade.
		await publish(client, "METAAAA2", "Drought and maize: a meta-analysis", "We pooled 40 trials across Malawi and Kenya.", 3);
		const regrade = jev(answering);
		await runReadingCycle(db, configWith("Smallholder farming in Africa"), undefined, regrade.request);
		expect(regrade.asked).toEqual([["grade_0"]]);

		// A failed call stores nothing new and leaves the record queued with the error.
		await publish(client, "METAAAA2", "Drought and maize: an updated meta-analysis", "We pooled 52 trials.", 4);
		const down = jev(() => new Response("upstream unavailable", { status: 503 }));
		await runReadingCycle(db, configWith("Smallholder farming in Africa"), undefined, down.request);
		const [job] = await db.select().from(itemReadingQueue);
		expect(job).toMatchObject({ attempts: 1, leaseToken: null });
		expect(job.lastError).toContain("503");
		expect(job.nextAttemptAt).not.toBeNull();
	});
}, 120_000);

it("does not read, when screening turns on, what was published while nothing screened", async () => {
	await withIsolatedPublicationDatabase(async (db, client) => {
		await publish(client, "BEFREAD2", "Coastal flooding in Lagos", "Flood risk across 40 wards.");
		const offConfig = libraryConfigSchema.parse({ ...maximalLibraryConfig, sources: [{ ...source, screening: { enabled: false } }] });
		await runReadingCycle(db, offConfig, undefined, jev(answering).request);
		const on = jev(answering);
		await runReadingCycle(db, configWith("Climate adaptation in farming"), undefined, on.request);
		expect(on.asked).toEqual([]);
		expect(await db.select().from(itemReading)).toEqual([]);
	});
}, 120_000);

it("grades a record for a screening source that starts holding it, though its revision does not change", async () => {
	await withIsolatedPublicationDatabase(async (db, client) => {
		const second = { ...source, key: "zotero-second", groupId: "7743475" };
		const both = libraryConfigSchema.parse({
			...configWith("Climate adaptation in farming"),
			sources: [{ ...source, screening: { enabled: true, subject: "Climate adaptation in farming" } }, { ...second, screening: { enabled: true, subject: "Water security" } }],
		});
		await publish(client, "LAPPED22", "Irrigation and drought in Kenya", "Smallholders adopted drip irrigation.");
		await runReadingCycle(db, both, undefined, jev(answering).request);

		await client.query(`INSERT INTO "sourceConnection" (key, provider, "scopeKind", "externalScopeKey") VALUES ($1, 'zotero', 'group', '7743475')`, [second.key]);
		await client.query(`INSERT INTO "itemSourceLink" ("itemKey", "sourceConnectionKey", "sourceRecordKey") VALUES ('LAPPED22', $1, 'LAPPED22')`, [second.key]);
		const picked = jev(answering);
		await runReadingCycle(db, both, undefined, picked.request);
		expect(picked.asked).toEqual([["grade_0"]]);
		expect((await db.select({ source: itemGrade.sourceConnectionKey }).from(itemGrade)).map((grade) => grade.source).sort()).toEqual([second.key, source.key].sort());
	});
}, 120_000);
