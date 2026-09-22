import { CITATION_RECORD_COLUMNS } from "@/lib/citation-record-columns";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { readPublicDoiAttachments, readPublicIdentifiers } from "@/lib/publication/public-identifiers";
import { resolvePublicDoi } from "@/lib/publication/publication-identifier-summary";
import { publicItemVisibility, publicParentVisibility } from "@/lib/public-item-visibility";
import { and, asc, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { item } from "@/db/schema/tables/item";
import { readItemTags } from "@/lib/item-tags";

/** Public card metadata in one batch; drafts and PDF text never leave this read. */
export async function getPublicItemCards(
	database: Pick<Database, "query" | "select">,
	keys: readonly string[],
	config: LibraryServerConfig,
	includeCitationFields = false,
) {
	if (!keys.length) return [];
	const hiddenTags = config.content.tags.hidden;
	const records = await database.query.item.findMany({
		where: and(inArray(item.key, [...keys]), publicParentVisibility(database, hiddenTags)),
		columns: {
			...(includeCitationFields ? Object.fromEntries(CITATION_RECORD_COLUMNS.map(column => [column, true as const])) : {}),
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
	const publicKeys = records.map(record => record.key);
	if (!publicKeys.length) return [];
	const [identifiers, doiAttachments, covers, tags] = await Promise.all([
		readPublicIdentifiers(database, records, config.services.publication),
		readPublicDoiAttachments(database, publicKeys, hiddenTags),
		database.select({
			parentItem: item.parentItem,
			PDFCoverPageImage: item.PDFCoverPageImage,
			PDFCoverPageWidth: item.PDFCoverPageWidth,
			PDFCoverPageHeight: item.PDFCoverPageHeight,
		}).from(item).where(and(
			inArray(item.parentItem, publicKeys), isNotNull(item.PDFCoverPageImage),
			publicItemVisibility(database, hiddenTags),
		)).orderBy(asc(item.key)),
		readItemTags(database, includeCitationFields ? publicKeys : []),
	]);
	const coverByParent = new Map<string, Omit<(typeof covers)[number], "parentItem">>();
	for (const { parentItem, ...cover } of covers) {
		if (parentItem && !coverByParent.has(parentItem)) coverByParent.set(parentItem, cover);
	}
	return records.map(({ deleted: _deleted, parentItem: _parent, extra, ...card }) => ({
		...card,
		...(includeCitationFields ? { extra, tags: tags.get(card.key) ?? [] } : {}),
		...(!card.PDFCoverPageImage ? coverByParent.get(card.key) : undefined),
		DOI: resolvePublicDoi({ ...card, extra, attachments: doiAttachments.get(card.key), publicationIdentifiers: identifiers.get(card.key) }),
	}));
}

export async function getPublicItemCard(database: Pick<Database, "query" | "select">, key: string, config: LibraryServerConfig) {
	return (await getPublicItemCards(database, [key], config))[0] ?? null;
}
