import { ListItem } from "../item/types";
import type { MeaningInfo } from "@/lib/meaning-search-rules";

export type ItemsGetResponse = {
  items: ListItem[];
  currentPage: number;
  totalItems: number;
  perPage: number;
  totalPages: number;
  /** Set when the search compared meaning, or would have and the reader hid those results. */
  meaning?: MeaningInfo;
};
