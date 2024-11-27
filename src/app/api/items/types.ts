import { InferSelectModel } from "drizzle-orm";
import { item } from "@/db/schema/tables/item";

export type Item = InferSelectModel<typeof item>;

export type ItemsGetResponse = {
  items: Item[] | any[];
  currentPage: number;
  totalItems: number;
  perPage: number;
  totalPages: number;
};
