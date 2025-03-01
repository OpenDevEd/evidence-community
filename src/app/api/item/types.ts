import { InferSelectModel } from "drizzle-orm";
import { item } from "@/db/schema/tables/item";
import { Collection } from "../collections/types";

export type Item = InferSelectModel<typeof item> & {
  attachmentsData?: Item[];
  collectionsData?: Collection[];
  collectionsAncestry?: string[];
  year?: string;
  fullTextPDFs?: Array<{ key: string; fullTextPDF: Array<{ text: string, page: number }> }>;
  institution?: string[];
};

export type ItemGetResponse = {
  item: Item | undefined;
};
