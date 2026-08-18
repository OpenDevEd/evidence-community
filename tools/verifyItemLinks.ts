import { and, eq, inArray } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { item } from "../src/db/schema/tables/item";
import { itemLink } from "../src/db/schema/tables/itemLink";
import { itemDraft, itemIdentity, outbox } from "../src/db/schema/source";
import { NativeItemValidationError } from "../src/lib/admin/native-item-validation";
import {
	createNativeItemDraft,
	openItemDraft,
	publishItemDraft,
	removeNativeItem,
	saveItemDraft,
} from "../src/lib/admin/native-item-service";
import {
	getIncomingLinks,
	getManualLinkKeys,
	getOutgoingLinks,
	getPublicItemLinks,
	replaceManualLinks,
	replaceSourceRelatedLinks,
	sourceItemLinkOrigin,
} from "../src/lib/links/item-links";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) {
	throw new Error("DATABASE_URL_POST is required");
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function expectRejected(
	work: () => Promise<unknown>,
	pattern: RegExp,
	message: string,
) {
	try {
		await work();
	} catch (error) {
		const text = [
			error instanceof Error ? error.message : String(error),
			error instanceof Error && error.cause instanceof Error
				? error.cause.message
				: "",
		].join("\n");
		assert(pattern.test(text), `${message}: unexpected error ${text}`);
		return;
	}
	throw new Error(message);
}

const KEYS = ["LNKA2345", "LNKB2345", "LNKC2345", "LNKD2345"] as const;
const [A, B, C, D] = KEYS;
const SOURCE = "zotero-openscholar-test";
const nativeKeys: string[] = [];

async function verify() {
	const resource = createPostgresDatabaseResource(databaseUrl!);
	const db = resource.database;
	try {
		await cleanup(db);
		await db.insert(itemIdentity).values(
			KEYS.map((key) => ({
				key,
				sourceConnectionKey: "native",
				sourceRecordKey: key,
			})),
		);
		await db.insert(item).values(
			KEYS.map((key, index) => ({
				key,
				sourceConnectionKey: "native",
				sourceRecordKey: key,
				itemType: "Book" as const,
				title: `Link record ${index + 1}`,
			})),
		);

		// Constraints
		await expectRejected(
			() =>
				db.insert(itemLink).values({
					fromKey: A,
					toKey: A,
					kind: "cites",
					origin: "manual",
				}),
			/itemLink_not_self/,
			"Self-links must be rejected",
		);
		await expectRejected(
			() =>
				db.insert(itemLink).values({
					fromKey: A,
					toKey: B,
					kind: "mentions" as never,
					origin: "manual",
				}),
			/itemLink_kind_valid/,
			"Unknown kinds must be rejected",
		);
		await expectRejected(
			() =>
				db.insert(itemLink).values({
					fromKey: A,
					toKey: B,
					kind: "cites",
					origin: "zotero",
				}),
			/itemLink_origin_valid/,
			"Origins must be manual or source:<key>",
		);
		await db.insert(itemLink).values({
			fromKey: A,
			toKey: B,
			kind: "cites",
			origin: "manual",
		});
		await expectRejected(
			() =>
				db.insert(itemLink).values({
					fromKey: A,
					toKey: B,
					kind: "cites",
					origin: sourceItemLinkOrigin(SOURCE),
				}),
			/itemLink_fromKey_toKey_kind_pk|duplicate key/,
			"The same pair and kind may exist only once",
		);

		// Manual replacement
		const first = await replaceManualLinks(db, {
			fromKey: A,
			kind: "cites",
			toKeys: [B, C, C, A],
		});
		assert(
			first.added.join() === C && first.removed.length === 0,
			"replaceManualLinks must add only new keys, ignore duplicates and self",
		);
		const second = await replaceManualLinks(db, {
			fromKey: A,
			kind: "cites",
			toKeys: [C],
		});
		assert(
			second.removed.join() === B && second.added.length === 0,
			"replaceManualLinks must remove keys that are no longer wanted",
		);
		await replaceManualLinks(db, { fromKey: A, kind: "related", toKeys: [D] });
		const manual = await getManualLinkKeys(db, A);
		assert(
			manual.cites.join() === C && manual.related.join() === D,
			"getManualLinkKeys must group manual rows by kind",
		);

		// Source mirroring never touches manual rows and skips manual pairs
		const mirror = await replaceSourceRelatedLinks(db, {
			sourceConnectionKey: SOURCE,
			fromKeys: [A, B],
			links: [
				{ fromKey: A, toKey: D },
				{ fromKey: A, toKey: B },
				{ fromKey: B, toKey: A },
				{ fromKey: B, toKey: B },
			],
		});
		assert(
			mirror.inserted === 2 && mirror.skippedManual === 1,
			`Source mirroring must insert A→B and B→A, skip the manual A→D pair and the self link (got ${JSON.stringify(mirror)})`,
		);
		const manualAfterMirror = await getManualLinkKeys(db, A);
		assert(
			manualAfterMirror.related.join() === D,
			"Source mirroring must leave manual rows alone",
		);
		const secondMirror = await replaceSourceRelatedLinks(db, {
			sourceConnectionKey: SOURCE,
			fromKeys: [A, B],
			links: [{ fromKey: B, toKey: A }],
		});
		assert(secondMirror.inserted === 1, "Second mirror inserts the remaining pair");
		const aOutgoing = await getOutgoingLinks(db, A);
		assert(
			aOutgoing.length === 2 &&
				aOutgoing.every((row) => row.origin === "manual"),
			"After the second mirror A keeps only its manual rows",
		);
		const aIncoming = await getIncomingLinks(db, A, { kind: "related" });
		assert(
			aIncoming.length === 1 && aIncoming[0].fromKey === B,
			"B→A source row remains after the second mirror",
		);

		// Public reads: union, dedupe, hide unpublished targets
		const publicA = await getPublicItemLinks(db, A);
		assert(
			publicA.cites.join() === C &&
				publicA.related.slice().sort().join() === [B, D].join() &&
				publicA.citedBy.length === 0,
			`Public links for A are wrong: ${JSON.stringify(publicA)}`,
		);
		const publicC = await getPublicItemLinks(db, C);
		assert(
			publicC.citedBy.join() === A,
			"C must be cited by A through the reverse query",
		);
		await db.update(item).set({ deleted: 1 }).where(eq(item.key, C));
		const publicAHidden = await getPublicItemLinks(db, A);
		assert(
			publicAHidden.cites.length === 0,
			"Unpublished targets must be hidden from public links",
		);
		await db.update(item).set({ deleted: 0 }).where(eq(item.key, C));
		assert(
			(await getPublicItemLinks(db, A)).cites.join() === C,
			"Restored targets must reappear",
		);

		// Cascade
		await db.delete(item).where(eq(item.key, D));
		const dRows = await db
			.select()
			.from(itemLink)
			.where(eq(itemLink.toKey, D));
		assert(dRows.length === 0, "Deleting an item must cascade its links");

		// Draft → publish path (editor-owned links)
		const draftA = await createNativeItemDraft(db, {
			itemType: "Book",
			title: "Publish link source",
			creators: [{ creatorType: "author", name: "Link Author" }],
		});
		const draftB = await createNativeItemDraft(db, {
			itemType: "Book",
			title: "Publish link target",
			creators: [{ creatorType: "author", name: "Link Author" }],
		});
		nativeKeys.push(draftA.itemKey, draftB.itemKey);
		await publishItemDraft(db, draftB.itemKey);
		const publishedB = await db
			.select({ revision: item.revision })
			.from(item)
			.where(eq(item.key, draftB.itemKey))
			.then((rows) => rows[0]!);
		const savedA = await saveItemDraft(db, {
			itemKey: draftA.itemKey,
			expectedDraftRevision: draftA.draftRevision,
			expectedPayload: draftA.payload,
			payload: {
				...draftA.payload,
				links: { cites: [draftB.itemKey], related: [B] },
			},
		});
		assert(
			JSON.stringify(savedA.patch.links) ===
				JSON.stringify({ cites: [draftB.itemKey], related: [B] }),
			"Draft save must keep links in the patch",
		);
		await expectRejected(
			() =>
				saveItemDraft(db, {
					itemKey: draftA.itemKey,
					expectedDraftRevision: savedA.draftRevision,
					expectedPayload: savedA.payload,
					payload: {
						...savedA.payload,
						links: { cites: [draftA.itemKey], related: [] },
					},
				}),
			/cannot link to itself/,
			"Self links must be rejected when saving a draft",
		);
		await publishItemDraft(db, draftA.itemKey);
		const publishedLinks = await getManualLinkKeys(db, draftA.itemKey);
		assert(
			publishedLinks.cites.join() === draftB.itemKey &&
				publishedLinks.related.join() === B,
			`Publish must write manual link rows: ${JSON.stringify(publishedLinks)}`,
		);
		const bAfter = await db
			.select({ revision: item.revision })
			.from(item)
			.where(eq(item.key, draftB.itemKey))
			.then((rows) => rows[0]!);
		assert(
			bAfter.revision === publishedB.revision + 1,
			"Publishing a link must bump the target's revision",
		);
		const outboxRows = await db
			.select({ entityKey: outbox.entityKey, revision: outbox.revision })
			.from(outbox)
			.where(inArray(outbox.entityKey, [draftA.itemKey, draftB.itemKey, B]))
			.orderBy(outbox.id);
		assert(
			outboxRows.some(
				(row) => row.entityKey === draftB.itemKey && row.revision === bAfter.revision,
			) && outboxRows.some((row) => row.entityKey === B),
			`Publish must enqueue outbox rows for both link targets: ${JSON.stringify(outboxRows)}`,
		);
		const draftPayloadAfterPublish = await openItemDraft(db, draftA.itemKey);
		assert(
			JSON.stringify(draftPayloadAfterPublish.payload.links) ===
				JSON.stringify({ cites: [draftB.itemKey], related: [B] }) &&
				Object.keys(draftPayloadAfterPublish.patch).length === 0,
			"Reopening the record must show published links with an empty patch",
		);
		const removed = await saveItemDraft(db, {
			itemKey: draftA.itemKey,
			expectedDraftRevision: draftPayloadAfterPublish.draftRevision,
			expectedPayload: draftPayloadAfterPublish.payload,
			payload: {
				...draftPayloadAfterPublish.payload,
				links: { cites: [], related: [B] },
			},
		});
		assert(
			JSON.stringify(removed.patch.links) ===
				JSON.stringify({ cites: [], related: [B] }),
			"Removing a link must show only the links field in the patch",
		);
		await publishItemDraft(db, draftA.itemKey);
		const afterRemove = await getManualLinkKeys(db, draftA.itemKey);
		assert(
			afterRemove.cites.length === 0 && afterRemove.related.join() === B,
			"Publishing a removal must delete only that manual row",
		);
		const outboxAfterRemove = await db
			.select({ entityKey: outbox.entityKey })
			.from(outbox)
			.where(eq(outbox.entityKey, draftB.itemKey));
		assert(
			outboxAfterRemove.length >= 2,
			"Removing a link must reindex the former target",
		);
		const missingDraft = await openItemDraft(db, draftA.itemKey);
		await saveItemDraft(db, {
			itemKey: draftA.itemKey,
			expectedDraftRevision: missingDraft.draftRevision,
			expectedPayload: missingDraft.payload,
			payload: {
				...missingDraft.payload,
				links: { cites: ["ZZZZ9999"], related: [B] },
			},
		});
		let missingRejected = false;
		try {
			await publishItemDraft(db, draftA.itemKey);
		} catch (error) {
			missingRejected =
				error instanceof NativeItemValidationError &&
				/no longer exists/.test(error.message);
		}
		assert(missingRejected, "Publishing a link to a missing record must fail");
		assert(
			(await getManualLinkKeys(db, draftA.itemKey)).related.join() === B,
			"A failed publish must not change link rows",
		);
		const stillDraft = await db
			.select({ itemKey: itemDraft.itemKey })
			.from(itemDraft)
			.where(eq(itemDraft.itemKey, draftA.itemKey));
		assert(stillDraft.length === 1, "A failed publish must keep the draft");
		await removeNativeItem(db, draftB.itemKey);
		assert(
			(await getManualLinkKeys(db, draftA.itemKey)).cites.length === 0,
			"Removing a record must cascade its incoming links",
		);

		console.log("Item link verification passed");
	} finally {
		await cleanup(db);
		await resource.dispose();
	}
}

async function cleanup(db: ReturnType<typeof createPostgresDatabaseResource>["database"]) {
	const keys = [...KEYS, ...nativeKeys];
	await db.delete(outbox).where(inArray(outbox.entityKey, keys));
	await db.delete(itemDraft).where(inArray(itemDraft.itemKey, keys));
	await db.delete(item).where(inArray(item.key, keys));
	await db
		.delete(itemIdentity)
		.where(
			and(
				inArray(itemIdentity.key, keys),
				eq(itemIdentity.sourceConnectionKey, "native"),
			),
		);
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
