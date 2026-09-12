import type { LibraryServerConfig } from "@/config/library-config/schema";
import { readPublicIdentifiers } from "@/lib/publication/public-identifiers";
import { resolvePublicDoi } from "@/lib/publication/publication-identifier-summary";
import { and, asc, eq, inArray, isNotNull, notExists, sql } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { itemToTag } from "@/db/schema/tables/itemToTag";

/** Public card metadata from the published record; drafts and PDF text never leave this read. */
export async function getPublicItemCard(
	database: Pick<Database, "query" | "select">,
	key: string,
	config: LibraryServerConfig,
) {
	const hiddenTags = config.content.tags.hidden;
	const visibleTags = hiddenTags.length
		? notExists(
				database
					.select({ key: itemToTag.itemKey })
					.from(itemToTag)
					.where(
						and(
							eq(itemToTag.itemKey, item.key),
							inArray(
								sql`lower(${itemToTag.tagName})`,
								hiddenTags.map((tag) => tag.toLowerCase()),
							),
						),
					),
			)
		: undefined;
	const record = await database.query.item.findFirst({
		where: and(eq(item.key, key), visibleTags),
		columns: {
			key: true,
			revision: true,
			title: true,
			itemType: true,
			creators: true,
			date: true,
			DOI: true,
			extra: true,
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
	const { deleted: _deleted, parentItem: _parent, extra, ...card } = record;
	const identifiers = await readPublicIdentifiers(
		database, [record], config.services.publication,
	);
	card.DOI = resolvePublicDoi({
		...card, extra, publicationIdentifiers: identifiers.get(key),
	});
	if (!card.PDFCoverPageImage) {
		const attachment = await database.query.item.findFirst({
			where: and(
				eq(item.parentItem, key),
				eq(item.deleted, 0),
				isNotNull(item.PDFCoverPageImage),
				visibleTags,
			),
			orderBy: asc(item.key),
			columns: {
				PDFCoverPageImage: true,
				PDFCoverPageWidth: true,
				PDFCoverPageHeight: true,
			},
		});
		if (attachment) Object.assign(card, attachment);
	}
	return card;
}
