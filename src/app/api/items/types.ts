import { ListItem } from "../item/types";
import type { SemanticInfo } from "@/lib/semantic-concepts";

export type ItemsGetResponse = {
  items: ListItem[];
  currentPage: number;
  totalItems: number;
  perPage: number;
  totalPages: number;
  semantic?: SemanticInfo;
};
