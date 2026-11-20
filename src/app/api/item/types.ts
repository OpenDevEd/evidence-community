import type { StudyReading } from "@/lib/readings/study-types";
import type { TopicTree } from "@/lib/topics/contract";
import { InferSelectModel } from "drizzle-orm";
import type { SourceProvider } from "@opendeved/evidence-library-core";
import { item } from "@/db/schema/tables/item";
import { Collection } from "../collections/types";
import type { PublicationIdentifierSummary } from "@/lib/publication/publication-display-adapter";
import type { SourceCitationMetric } from "@/lib/links/citation-metrics";

interface Institution {
	id?: string;
	country_code?: string;
	display_name?: string;
}

/** Links between library records, read from PostgreSQL. Only published records are listed. */
export type ItemLinks = {
	cites: string[];
	citedBy: string[];
	related: string[];
};

export type Item = InferSelectModel<typeof item> & {
	/** What kind of work the record is, as Jev read it when it came in. None until it has been read. */
	reading?: StudyReading;
	provider?: SourceProvider;
	links?: ItemLinks;
	citationMetrics?: SourceCitationMetric[];
	/** The higher of the library's citation count and a source's, as the index sorts by. */
	citationCount?: number;
	/** Whether OpenAlex says the record is open access; null when it does not know. */
	openAccess?: boolean | null;
	sourceExternalScopeKey?: string | null;
	tags?: string[];
	collections?: string[];
	attachmentsData?: Item[];
	/** A PDF the record keeps from readers for now (`heldPdf`): the day it opens, or null while only editors open it. */
	heldPdf?: { until: string | null } | null;
	collectionsData?: Collection[];
	collectionsAncestry?: string[];
	year?: string;
	fullTextPDFs?: Array<{
		key: string;
		fullTextPDF: Array<{ text?: string; page: number }>;
	}>;
	institution?: string[];
	fullNames?: string[];
	dateSortKey?: number;
	datePublished?: string;
	publicationIdentifiers?: PublicationIdentifierSummary;
};

/** The attachment fields the public item page reads; see `itemPageAttachments`. */
export type ListAttachment = Pick<
	Item,
	| "key"
	| "parentItem"
	| "itemType"
	| "linkMode"
	| "title"
	| "filename"
	| "url"
	| "contentType"
	| "tags"
	| "PDFCoverPageImage"
	| "PDFCoverPageWidth"
	| "PDFCoverPageHeight"
	| "note"
>;

export type ListItem = Omit<Item, "attachmentsData"> & {
	attachmentsData?: ListAttachment[];
};

export type ItemGetResponse = {
	item: Item | undefined;
	/** Names for the record's topics, sent with the item page's record. */
	topics?: TopicTree;
};

export type Author = {
	authorProfileId?: string;
	firstName?: string;
	lastName?: string;
	institution?: string;
	name?: string;
	creatorType: string;
	institutions?: Institution[];
};
