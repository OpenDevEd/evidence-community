import { and, eq, inArray } from "drizzle-orm";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { item } from "../src/db/schema/tables/item";
import { itemLink } from "../src/db/schema/tables/itemLink";
import { itemIdentity } from "../src/db/schema/source";
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

		console.log("Item link verification passed");
	} finally {
		await cleanup(db);
		await resource.dispose();
	}
}

async function cleanup(db: ReturnType<typeof createPostgresDatabaseResource>["database"]) {
	await db.delete(item).where(inArray(item.key, [...KEYS]));
	await db
		.delete(itemIdentity)
		.where(
			and(
				inArray(itemIdentity.key, [...KEYS]),
				eq(itemIdentity.sourceConnectionKey, "native"),
			),
		);
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
