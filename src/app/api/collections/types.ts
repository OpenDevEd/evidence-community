import { InferSelectModel } from "drizzle-orm";
import { collection } from "@/db/schema/tables/collection";

export type Collection = InferSelectModel<typeof collection> & {
  children?: Collection[];
  title?: string;
  level?: number;
}

export type CollectionsGetResponse = {
  collections: Collection[];
};