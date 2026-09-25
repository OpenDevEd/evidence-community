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
	provider?: SourceProvider;
	links?: ItemLinks;
	citationMetrics?: SourceCitationMetric[];
	sourceExternalScopeKey?: string | null;
	tags?: string[];
	collections?: string[];
	attachmentsData?: Item[];
	collectionsData?: Collection[];
	collectionsAncestry?: string[];
	year?: string;
	fullTextPDFs?: Array<{
		key: string;
		fullTextPDF: Array<{ text: string; page: number }>;
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
	| "tags"
	| "PDFCoverPageImage"
	| "note"
>;

export type ListItem = Omit<Item, "attachmentsData"> & {
	attachmentsData?: ListAttachment[];
};

export type ItemGetResponse = {
	item: Item | undefined;
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
