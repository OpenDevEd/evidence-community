import { itemIdentity, outbox } from "@opendeved/evidence-library-core";
import { eq } from "drizzle-orm";
import { Client } from "pg";

import { createPostgresDatabaseResource } from "../src/db/postgres";
import { adminItemListProjection } from "../src/db/schema/tables/adminItemListProjection";
import { item } from "../src/db/schema/tables/item";
import { tag } from "../src/db/schema/tables/tag";
import {
	createNativeItemDraft,
	publishItemDraft as publishNativeItemDraft,
} from "../src/lib/admin/native-item-service";

const databaseUrl = process.env.DATABASE_URL_POST;
if (!databaseUrl) throw new Error("DATABASE_URL_POST is required");
const verifiedDatabaseUrl = databaseUrl;

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function verify() {
	const resource = createPostgresDatabaseResource(verifiedDatabaseUrl);
	const first = new Client({ connectionString: verifiedDatabaseUrl });
	const second = new Client({ connectionString: verifiedDatabaseUrl });
	const tagName = `projection-concurrency-${process.pid}`;
	let itemKey: string | null = null;
	await Promise.all([first.connect(), second.connect()]);
	try {
		const draft = await createNativeItemDraft(resource.database, {
			itemType: "Report",
			title: "Before concurrent writes",
		});
		itemKey = draft.itemKey;
		await publishNativeItemDraft(resource.database, itemKey);
		await resource.database.insert(tag).values({ name: tagName });

		await first.query("BEGIN");
		await first.query("UPDATE item SET title = $1 WHERE key = $2", [
			"Title from first transaction",
			itemKey,
		]);

		await second.query("BEGIN");
		const relationWrite = second.query(
			'INSERT INTO "itemToTag" ("itemKey", "tagName") VALUES ($1, $2)',
			[itemKey, tagName],
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		await first.query("COMMIT");
		await relationWrite;
		await second.query("COMMIT");

		const [projection] = await resource.database
			.select()
			.from(adminItemListProjection)
			.where(eq(adminItemListProjection.key, itemKey));
		assert(
			projection?.title === "Title from first transaction" &&
				projection.tags.includes(tagName),
			"Concurrent writes overwrote part of the projected row",
		);
		console.log(JSON.stringify({ itemKey, serialized: true }));
	} finally {
		await Promise.allSettled([
			first.query("ROLLBACK"),
			second.query("ROLLBACK"),
		]);
		if (itemKey) {
			await resource.database
				.delete(outbox)
				.where(eq(outbox.entityKey, itemKey));
			await resource.database.delete(item).where(eq(item.key, itemKey));
			await resource.database
				.delete(itemIdentity)
				.where(eq(itemIdentity.key, itemKey));
		}
		await resource.database.delete(tag).where(eq(tag.name, tagName));
		await Promise.all([first.end(), second.end(), resource.dispose()]);
	}
}

verify().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
