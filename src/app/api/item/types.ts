import { InferSelectModel } from "drizzle-orm";
import { item } from "@/db/schema/tables/item";
import { Collection } from "../collections/types";

interface Institution {
  id?: string;
  country_code?: string;
  display_name?: string;
}

export type Item = InferSelectModel<typeof item> & {
  attachmentsData?: Item[];
  collectionsData?: Collection[];
  collectionsAncestry?: string[];
  year?: string;
  fullTextPDFs?: Array<{ key: string; fullTextPDF: Array<{ text: string, page: number }> }>;
  institution?: string[];
  fullNames?: string[];
  dateTimestamp?: string;
  datePublished?: string;
};

export type ListAttachment = Omit<
	Item,
	"attachmentsData" | "fullTextPDFs" | "fullTextPDF" | "PDFCoverPageImage" | "PDFCoverPageWidth" | "PDFCoverPageHeight"
>;

export type ListItem = Omit<Item, "attachmentsData"> & {
	attachmentsData?: ListAttachment[];
};

export type ItemGetResponse = {
  item: Item | undefined;
};

export type Author = {
	firstName: string;
	lastName: string;
	institution: string;
	name: string;
	creatorType: string;
	institutions?: Institution[];
};
