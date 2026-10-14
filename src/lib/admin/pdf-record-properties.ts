import { and, eq } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { publicationIdentifier } from "@/db/schema/publication";
import { canonicalItemTypeToZotero, primaryCreatorType } from "@/lib/item-field-codec";
import { resolveTopicNodes } from "@/lib/topics/catalog";

import { pdfPropertiesOfRecord, type PdfProperties } from "./pdf-record-mapping";

const textOf = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * What a published PDF carries in its own metadata: the record as it is
 * published, its makers in the role its type names first (authors, a
 * film's directors; everyone when no creator has that role), its topics by
 * name among the keywords, and its DOI, the
 * record's own or the Crossref DOI the library reserved for it. A Zenodo
 * DOI only exists once the file is archived, so it can't be in the file.
 */
export async function recordPdfProperties(db: Database, config: LibraryServerConfig, itemKey: string, payload: Record<string, unknown>): Promise<PdfProperties> {
	const creators = Array.isArray(payload.creators) ? (payload.creators as Record<string, unknown>[]) : [];
	const primary = primaryCreatorType(canonicalItemTypeToZotero(payload.itemType));
	const makers = creators.some(({ creatorType }) => creatorType === primary) ? creators.filter(({ creatorType }) => creatorType === primary) : creators;
	const authors = makers.flatMap((creator) => {
		const name = [textOf(creator.firstName), textOf(creator.lastName)].filter(Boolean).join(" ") || textOf(creator.name);
		return name ? [name] : [];
	});
	const topicIds = Array.isArray(payload.topics) ? payload.topics.filter((id): id is string => typeof id === "string") : [];
	const topics = config.topics.enabled && topicIds.length ? await resolveTopicNodes(topicIds, { config, database: db }, { allowUnknown: true }) : [];
	const [reserved] = textOf(payload.DOI)
		? []
		: await db
				.select({ doi: publicationIdentifier.doi })
				.from(publicationIdentifier)
				.where(and(eq(publicationIdentifier.itemKey, itemKey), eq(publicationIdentifier.registrar, "crossref"), eq(publicationIdentifier.environment, config.services.publication.crossref.environment), eq(publicationIdentifier.role, "primary"), eq(publicationIdentifier.isCurrent, true)));
	return pdfPropertiesOfRecord(payload, { authors, doi: reserved?.doi ?? "", keywords: topics.map(({ name }) => name) });
}
