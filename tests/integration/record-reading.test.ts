import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { libraryConfigSchema } from "@/config/library-config/schema";
import { item } from "@/db/schema/tables/item";
import { itemGrade, itemReading, itemReadingQueue, readingSpend } from "@/db/schema/readings";
import { publicParentVisibility } from "@/lib/public-item-visibility";
import { readScreeningStatuses, requestGrading, saveSourceScreening } from "@/lib/readings/screening";
import { readSourceStatuses } from "@/lib/source-ingestion/source-status";
import { runReadingCycle, trySubject } from "@/lib/readings/worker";
import { readPublicItem } from "@/lib/search-index/projection";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

type Client = { query: (text: string, values?: unknown[]) => Promise<unknown> };

const source = maximalLibraryConfig.sources[0];
const second = { ...source, key: "zotero-second", groupId: "7743475" };
const configWith = (subject: string, keptOut = ["not-about"], others: unknown[] = []) => libraryConfigSchema.parse({
	...maximalLibraryConfig,
	ai: { ...maximalLibraryConfig.ai, providers: [...maximalLibraryConfig.ai.providers, { provider: "openrouter", enabled: true, apiKey: "library-openrouter-key", models: ["openai/gpt-6-luna"], defaultModel: "openai/gpt-6-luna" }] },
	sources: [{ ...source, screening: { enabled: true, subject, keptOut } }, ...others],
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

it("reads the type of every record a library with a key brings in, grades only for sources that screen, and reads nothing without a key", async () => {
	await withIsolatedPublicationDatabase(async (db, client) => {
		const keyed = configWith("unused");
		const unscreened = libraryConfigSchema.parse({ ...keyed, sources: [{ ...source, screening: { enabled: false } }] });
		await publish(client, "TYPEAAA2", "Drought and maize: a meta-analysis", "We pooled 40 trials.");
		const typed = jev(answering);
		await runReadingCycle(db, unscreened, undefined, typed.request);
		expect(typed.asked).toEqual([["type", "pooled", "region", "effects"]]);
		expect(await db.select().from(itemGrade)).toEqual([]);
		// Readers see the type on the record: its search document carries it.
		expect((await readPublicItem(db, "TYPEAAA2", unscreened))?.reading).toEqual({ type: "meta-analysis", confidence: 0.91, by: "ai", input: "abstract" });

		await publish(client, "KEYLESS2", "Coastal flooding in Lagos", "Flood risk across 40 wards.");
		const keyless = libraryConfigSchema.parse({ ...maximalLibraryConfig, sources: [{ ...source, screening: { enabled: false } }] });
		const none = jev(answering);
		await runReadingCycle(db, keyless, undefined, none.request);
		expect(none.asked).toEqual([]);
		expect((await db.select({ key: itemReading.itemKey }).from(itemReading)).map((row) => row.key)).toEqual(["TYPEAAA2"]);
	});
}, 120_000);

it("grades a record for a screening source that starts holding it, though its revision does not change", async () => {
	await withIsolatedPublicationDatabase(async (db, client) => {
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
		const gradedBy = async () => (await db.select({ source: itemGrade.sourceConnectionKey }).from(itemGrade)).map((grade) => grade.source).sort();
		expect(await gradedBy()).toEqual([second.key, source.key].sort());

		const setRemoteDeleted = (deleted: boolean) => client.query(`UPDATE "itemSourceLink" SET "remoteDeleted" = $1 WHERE "itemKey" = 'LAPPED22' AND "sourceConnectionKey" = $2`, [deleted, second.key]);
		await setRemoteDeleted(false);
		const untouched = jev(answering);
		await runReadingCycle(db, both, undefined, untouched.request);
		expect(untouched.asked).toEqual([]);

		await setRemoteDeleted(true);
		expect(await gradedBy()).toEqual([source.key]);
		await setRemoteDeleted(false);
		const restored = jev(answering);
		await runReadingCycle(db, both, undefined, restored.request);
		expect(restored.asked).toEqual([["grade_0"]]);
		expect(await gradedBy()).toEqual([second.key, source.key].sort());
	});
}, 120_000);

type Db = Parameters<Parameters<typeof withIsolatedPublicationDatabase>[0]>[0];
const store = (db: Db, config: ReturnType<typeof configWith>) => db.transaction((tx) => saveSourceScreening(tx, config.sources));
const visible = async (db: Db) => (await db.select({ key: item.key }).from(item).where(publicParentVisibility(db, []))).map((row) => row.key).sort();
const scoring = (score: number) => (questions: string[]) => Response.json({
	model: "typesafe/jev-1.13", usage: { input_tokens: 900, cost: 0.00004 },
	answers: Object.fromEntries(questions.map((id) => [id, id.startsWith("grade_") ? { type: "score", score } : ANSWERS[id]])),
});
const linkSecond = async (client: Client, key: string) => {
	await client.query(`INSERT INTO "sourceConnection" (key, provider, "scopeKind", "externalScopeKey") VALUES ($1, 'zotero', 'group', '7743475') ON CONFLICT DO NOTHING`, [second.key]);
	await client.query(`INSERT INTO "itemSourceLink" ("itemKey", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, $2, $1)
		ON CONFLICT ("itemKey", "sourceConnectionKey") DO UPDATE SET "remoteDeleted" = false`, [key, second.key]);
};

it("screens a record out only while every source holding it keeps its grade out", async () => {
	await withIsolatedPublicationDatabase(async (db, client) => {
		const config = configWith("Climate adaptation in farming", ["not-about"], [second]);
		await publish(client, "FFTPCAA2", "Corporate bond yields in 2026", "Bond spreads widened.");
		await publish(client, "NTPCAAA2", "Drought-tolerant maize", "Smallholders adopted new seed.");
		await store(db, config);
		await runReadingCycle(db, config, undefined, jev((questions) => scoring(0.2)(questions)).request);
		expect(await visible(db)).toEqual([]);
		expect((await readSourceStatuses(db, { hiddenTags: [] })).find((status) => status.key === source.key)?.searchable).toBe(0);

		// A source that does not screen brings the record in.
		await linkSecond(client, "FFTPCAA2");
		await runReadingCycle(db, config, undefined, jev(answering).request);
		expect(await visible(db)).toEqual(["FFTPCAA2"]);

		// Withdrawn from that source, the record is out again.
		await client.query(`UPDATE "itemSourceLink" SET "remoteDeleted" = true WHERE "sourceConnectionKey" = $1`, [second.key]);
		await runReadingCycle(db, config, undefined, jev(answering).request);
		expect(await visible(db)).toEqual([]);

		// A source removed from the configuration no longer holds what it brought in.
		await linkSecond(client, "FFTPCAA2");
		await runReadingCycle(db, config, undefined, jev(answering).request);
		expect(await visible(db)).toEqual(["FFTPCAA2"]);
		await client.query(`UPDATE "sourceConnection" SET status = 'removed' WHERE key = $1`, [second.key]);
		await db.transaction((tx) => saveSourceScreening(tx, config.sources, [second.key]));
		expect(await visible(db)).toEqual([]);

		// Keeping no grade out lets every record back in.
		await store(db, configWith("Climate adaptation in farming", [], [second]));
		expect(await visible(db)).toEqual(["FFTPCAA2", "NTPCAAA2"]);
	});
}, 120_000);

it("grades a new subject in waiting, and swaps the new grades in only once the owner's request has graded every record", async () => {
	await withIsolatedPublicationDatabase(async (db, client) => {
		const before = configWith("Climate adaptation in farming");
		await publish(client, "SWAPAAA2", "Irrigation in Kenya", "Drip irrigation spread.");
		await publish(client, "SWAPBBB2", "Irrigation in Malawi", "Canal irrigation spread.");
		await store(db, before);
		await runReadingCycle(db, before, undefined, jev(scoring(2.8)).request);

		const after = configWith("Urban housing policy");
		// Until the workers store the new subject, a request to grade against it is refused, and one for a subject the
		// source no longer screens against is refused outright.
		expect(await requestGrading(db, after, source.key)).toBe("not_ready");
		await store(db, after);
		expect(await requestGrading(db, after, source.key, "Climate adaptation in farming")).toBe("subject_changed");
		expect((await readScreeningStatuses(db)).get(source.key)).toEqual({
			subject: "Urban housing policy",
			records: 2,
			grades: { about: 2, touches: 0, passing: 0, notAbout: 0 },
			examples: { about: expect.stringMatching(/^Irrigation in (Kenya|Malawi)$/u), touches: null, passing: null, notAbout: null },
			ungraded: 2,
			grading: null,
			reading: null,
		});
		expect(await requestGrading(db, after, source.key)).toEqual({ queued: 2 });
		// Asked again before anything was read: the same request, and progress counts from where it began.
		expect(await requestGrading(db, after, source.key)).toEqual({ queued: 2 });
		expect((await readScreeningStatuses(db)).get(source.key)?.reading).toEqual({ title: expect.stringMatching(/^Irrigation in/u), left: 2 });

		// One record graded against the new subject: its grade waits, and both records stay in.
		let calls = 0;
		await runReadingCycle(db, after, undefined, jev((questions) => (calls++ ? new Response("busy", { status: 503 }) : scoring(0.1)(questions))).request);
		expect((await readScreeningStatuses(db)).get(source.key)).toMatchObject({ grades: { about: 2 }, ungraded: 1, grading: { done: 1, of: 2 } });
		expect(await visible(db)).toEqual(["SWAPAAA2", "SWAPBBB2"]);

		await client.query(`UPDATE "itemReadingQueue" SET "nextAttemptAt" = now() WHERE "nextAttemptAt" IS NOT NULL`);
		await runReadingCycle(db, after, undefined, jev(scoring(0.1)).request);
		expect((await readScreeningStatuses(db)).get(source.key)).toMatchObject({
			grades: { about: 0, touches: 0, passing: 0, notAbout: 2 },
			examples: { about: null, notAbout: expect.stringMatching(/^Irrigation in/u) },
			ungraded: 0,
			grading: null,
		});
		expect(await visible(db)).toEqual([]);
		expect(await db.select({ pending: itemGrade.pendingSubjectHash }).from(itemGrade)).toEqual([{ pending: null }, { pending: null }]);

		// A request is spend on one subject: a new subject takes back what it queued.
		const third = configWith("Coastal fisheries");
		await store(db, third);
		expect(await requestGrading(db, third, source.key)).toEqual({ queued: 2 });
		await store(db, configWith("Inland fisheries"));
		const withdrawn = jev(answering);
		await runReadingCycle(db, configWith("Inland fisheries"), undefined, withdrawn.request);
		expect(withdrawn.asked).toEqual([]);
		expect((await readScreeningStatuses(db)).get(source.key)).toMatchObject({ ungraded: 2, grading: null });
	});
}, 120_000);

it("asks a type Jev was unsure of again from the record's PDF once it arrives", async () => {
	await withIsolatedPublicationDatabase(async (db, client) => {
		const config = configWith("Climate adaptation in farming");
		await publish(client, "UNSURE22", "Farming and heat", "Notes on heat.");
		await store(db, config);
		const unsure = (questions: string[]) => Response.json({
			model: "typesafe/jev-1.13", usage: { input_tokens: 900, cost: 0.00004 },
			answers: Object.fromEntries(questions.map((id) => [id, id === "type" ? { type: "choice", choice: "literature-review", confidence: 0.4 } : ANSWERS[id]])),
		});
		await runReadingCycle(db, config, undefined, jev(unsure).request);

		await client.query(`INSERT INTO "itemIdentity" (key, "sourceConnectionKey", "sourceRecordKey") VALUES ('UNSUREP2', $1, 'UNSUREP2')`, [source.key]);
		await client.query(`INSERT INTO item (key, "sourceConnectionKey", "sourceRecordKey", "itemType", "parentItem", "fullTextPDF", revision)
			VALUES ('UNSUREP2', $1, 'UNSUREP2', 'Attachment', 'UNSURE22', '**|| PAGE 1 ||** Methods. We searched five databases and pooled 30 trials.', 1)`, [source.key]);
		await client.query(`INSERT INTO outbox ("entityType", "entityKey", operation, revision) VALUES ('item', 'UNSUREP2', 'upsert', 1)`);
		const fromPdf = jev(answering);
		await runReadingCycle(db, config, undefined, fromPdf.request);
		expect(fromPdf.asked).toEqual([["type"]]);
		const sent = JSON.parse(String(vi.mocked(fromPdf.request).mock.calls[0]![1]!.body)) as { state: { fullTextOpening?: string } };
		expect(sent.state.fullTextOpening).toContain("pooled 30 trials");
		expect(await db.select({ type: itemReading.studyType, input: itemReading.input }).from(itemReading)).toEqual([{ type: "meta-analysis", input: "pdf" }]);
	});
}, 120_000);

it("tries a subject on the source's records without changing their grades", async () => {
	await withIsolatedPublicationDatabase(async (db, client) => {
		const config = configWith("Climate adaptation in farming");
		await publish(client, "TRIALAA2", "Irrigation in Kenya", "Drip irrigation spread.");
		await store(db, config);
		await runReadingCycle(db, config, undefined, jev(scoring(2.8)).request);

		const trial = await trySubject(db, config, source.key, "Urban housing policy", undefined, jev(scoring(0.1)).request);
		expect(trial).toEqual({ size: 1, now: { about: 1, touches: 0, passing: 0, notAbout: 0 }, next: { about: 0, touches: 0, passing: 0, notAbout: 1 }, changed: 1 });
		expect(await db.select({ grade: itemGrade.grade, pending: itemGrade.pendingGrade }).from(itemGrade)).toEqual([{ grade: "about", pending: null }]);
		expect((await db.select({ reads: readingSpend.reads }).from(readingSpend))[0]?.reads).toBe(2);
	});
}, 120_000);

it("grades a record an owner's request queued for the requesting source only", async () => {
	await withIsolatedPublicationDatabase(async (db, client) => {
		const both = (first: string, other: string) => configWith(first, ["not-about"], [{ ...second, screening: { enabled: true, subject: other } }]);
		await publish(client, "SHARED22", "Irrigation and drought in Kenya", "Smallholders adopted drip irrigation.");
		await linkSecond(client, "SHARED22");
		await store(db, both("Climate adaptation in farming", "Water security"));
		await runReadingCycle(db, both("Climate adaptation in farming", "Water security"), undefined, jev(scoring(2.8)).request);

		const changed = both("Urban housing policy", "Coastal fisheries");
		await store(db, changed);
		expect(await requestGrading(db, changed, source.key)).toEqual({ queued: 1 });
		// Queued for the first source only: the reading shows there, not on the second.
		const queued = await readScreeningStatuses(db);
		expect(queued.get(source.key)?.reading).toMatchObject({ left: 1 });
		expect(queued.get(second.key)?.reading).toBeNull();
		const asked = jev(scoring(0.1));
		await runReadingCycle(db, changed, undefined, asked.request);
		expect(asked.asked).toEqual([["grade_0"]]);
		const statuses = await readScreeningStatuses(db);
		expect(statuses.get(source.key)).toMatchObject({ grades: { notAbout: 1 }, ungraded: 0, grading: null });
		expect(statuses.get(second.key)).toMatchObject({ grades: { about: 1 }, ungraded: 1 });
	});
}, 120_000);

it("ends a grading request the library has no key to read for, and swaps finished grades in without one", async () => {
	await withIsolatedPublicationDatabase(async (db, client) => {
		await publish(client, "NKEYAAA2", "Irrigation in Kenya", "Drip irrigation spread.");
		await store(db, configWith("Climate adaptation in farming"));
		await runReadingCycle(db, configWith("Climate adaptation in farming"), undefined, jev(scoring(2.8)).request);
		const withoutKey = libraryConfigSchema.parse({ ...maximalLibraryConfig, sources: [{ ...source, screening: { enabled: true, subject: "Urban housing policy" } }] });
		await store(db, configWith("Urban housing policy"));
		expect(await requestGrading(db, configWith("Urban housing policy"), source.key)).toEqual({ queued: 1 });

		await runReadingCycle(db, withoutKey);
		expect((await readScreeningStatuses(db)).get(source.key)).toMatchObject({ ungraded: 1, grading: null });

		// Grades a cycle finished before it stopped: swapped in all the same.
		await client.query(`UPDATE "itemGrade" SET "pendingScore" = 0.1, "pendingGrade" = 'not-about', "pendingSubjectHash" = (SELECT "subjectHash" FROM "sourceScreening")`);
		await runReadingCycle(db, withoutKey);
		expect((await readScreeningStatuses(db)).get(source.key)).toMatchObject({ grades: { about: 0, notAbout: 1 }, ungraded: 0 });
	});
}, 120_000);
