import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { itemToTag } from "@/db/schema/tables/itemToTag";

/** Public card metadata from the published record; drafts and PDF text never leave this read. */
export async function getPublicItemCard(
	database: Pick<Database, "query" | "select">,
	key: string,
	hiddenTags: readonly string[],
) {
	const record = await database.query.item.findFirst({
		where: and(
			eq(item.key, key),
			hiddenTags.length
				? notExists(
						database
							.select({ key: itemToTag.itemKey })
							.from(itemToTag)
							.where(
								and(
									eq(itemToTag.itemKey, item.key),
									inArray(
										sql`lower(${itemToTag.tagName})`,
										hiddenTags.map((tag) =>
											tag.toLowerCase(),
										),
									),
								),
							),
					)
				: undefined,
		),
		columns: {
			key: true,
			revision: true,
			title: true,
			itemType: true,
			creators: true,
			date: true,
			DOI: true,
			abstractNote: true,
			PDFCoverPageImage: true,
			PDFCoverPageWidth: true,
			PDFCoverPageHeight: true,
			numPages: true,
			deleted: true,
			parentItem: true,
		},
	});
	if (!record || record.deleted || record.parentItem) {
		return null;
	}
	const { deleted: _deleted, parentItem: _parent, ...card } = record;
	return card;
}
