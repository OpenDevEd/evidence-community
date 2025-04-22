import { InferSelectModel } from "drizzle-orm";
import { collection } from "@/db/schema/tables/collection";

export type Collection = Omit<InferSelectModel<typeof collection>, "createdAt" | "updatedAt"> & {
  children?: Collection[];
  title?: string;
  level?: number;
  ancestry?: string[];
  originalFacet?: string;
  descendantsNames?: string[];
  createdAt?: any;
  updatedAt?: any;
}

export type CollectionsGetResponse = {
  collections: Collection[];
};