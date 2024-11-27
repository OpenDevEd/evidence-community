import { InferSelectModel } from "drizzle-orm";
import { collection } from "@/db/schema/tables/collection";

export type Collection = InferSelectModel<typeof collection>;

export type CollectionsGetResponse = {
  collections: InferSelectModel<typeof collection>[];
};

export type ColllectionHierarchy = Collection & {
  level?: number;
  children?: ColllectionHierarchy[];
  title?: string;
};
