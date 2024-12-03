import { InferSelectModel } from "drizzle-orm";
import { item } from "@/db/schema/tables/item";
import { Collection } from "../collections/types";

export type Item = InferSelectModel<typeof item> & {
  attachmentsData?: Item[];
  collectionsData?: Collection[];
};

export type ItemGetResponse = {
  item: Item | undefined;
};
