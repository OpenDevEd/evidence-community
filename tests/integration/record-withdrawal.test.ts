import assert from "node:assert/strict";
import { it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { item } from "../../src/db/schema/tables/item";
import { publicationSyncJob, publicationTarget } from "../../src/db/schema/publication";
import {
	createNativeItemDraft,
	ItemHasActivePublicationError,
	openItemDraft,
	publishItemDraft,
	removeNativeItem,
	unpublishNativeItemWithOutcome,
} from "../../src/lib/admin/native-item-service";
import { publicationRecordMetadata } from "../../src/lib/publication/record-metadata";

type Database = Parameters<Parameters<typeof withIsolatedPublicationDatabase>[0]>[0];

/** A published record with an attachment of its own (a note stands in for its PDF) and a DOI on Zenodo. */
async function recordWithDoi(db: Database, environment: "sandbox" | "production") {
	const parent = await createNativeItemDraft(db, { itemType: "Report", licence: { kind: "zenodo", id: "cc-by-4.0" }, title: "Peer tutoring pilot", date: "2026-11-18", creators: [{ creatorType: "author", firstName: "Grace", lastName: "Wanjiru" }] });
	await publishItemDraft(db, parent.itemKey);
	const child = await createNativeItemDraft(db, { itemType: "Note", note: "Its own attachment", parentItem: parent.itemKey });
	await publishItemDraft(db, child.itemKey);
	await db.insert(publicationTarget).values({ itemKey: parent.itemKey, provider: "zenodo", environment, identifierPolicy: "mint-zenodo", requestedBy: "editor" });
	return { parent: parent.itemKey, child: child.itemKey };
}

const row = async (db: Database, key: string) => (await db.select().from(item).where(eq(item.key, key)))[0]!;

// A demo community registers test DOIs, and an editor couldn't clear its records to show the PDF import again.
it("removes a record whose DOIs are test ones for good, its attachments with it", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const { parent, child } = await recordWithDoi(db, "sandbox");
		await removeNativeItem(db, parent);
		assert.equal((await row(db, parent)).deleted, 1);
		assert.equal((await row(db, parent)).withdrawnAt, null);
		assert.equal((await row(db, child)).deleted, 1);
		const [target] = await db.select().from(publicationTarget).where(eq(publicationTarget.itemKey, parent));
		assert.notEqual(target!.deactivatedAt, null, "A removed test DOI's target stays switched on");
	});
});

it("withdraws a record with a real DOI only with a reason, tells the registrars, and restores it with its attachments", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const { parent, child } = await recordWithDoi(db, "production");
		await assert.rejects(unpublishNativeItemWithOutcome(db, parent), ItemHasActivePublicationError);
		assert.equal((await row(db, parent)).deleted, 0);

		await unpublishNativeItemWithOutcome(db, parent, { withdrawal: { reason: "It duplicates another report." } });
		const withdrawn = await row(db, parent);
		assert.equal(withdrawn.deleted, 1);
		assert.ok(withdrawn.withdrawnAt);
		assert.equal(withdrawn.withdrawalReason, "It duplicates another report.");
		assert.equal((await row(db, child)).deleted, 1);
		assert.deepEqual((await row(db, child)).withdrawnAt, withdrawn.withdrawnAt);
		const [target] = await db.select().from(publicationTarget).where(eq(publicationTarget.itemKey, parent));
		assert.equal(target!.deactivatedAt, null, "A withdrawn record's DOI stays registered");
		const jobs = await db.select().from(publicationSyncJob).where(eq(publicationSyncJob.itemKey, parent));
		assert.ok(jobs.some((job) => job.canonicalRevision === withdrawn.revision), "Zenodo isn't told of the withdrawal");

		await openItemDraft(db, parent);
		await publishItemDraft(db, parent);
		const restored = await row(db, parent);
		assert.equal(restored.deleted, 0);
		assert.equal(restored.withdrawnAt, null);
		assert.equal(restored.withdrawalReason, null);
		assert.equal((await row(db, child)).deleted, 0, "Restoring left its attachment withdrawn");
	});
}, 60_000);

it("registers a withdrawn record saying so: its title starts WITHDRAWN and it carries the day", () => {
	const metadata = publicationRecordMetadata({ itemType: "Report", title: "Peer tutoring pilot", date: "2026-11-18", abstractNote: null, languageName: null, publisher: null, rights: null, creators: [], withdrawnAt: new Date("2026-11-20T09:00:00Z") }, [], null);
	assert.equal(metadata.title, "WITHDRAWN: Peer tutoring pilot");
	assert.equal(metadata.withdrawnOn, "2026-11-20");
});
