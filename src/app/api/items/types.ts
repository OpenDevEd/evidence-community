import { Item } from "../item/types";

export type ItemsGetResponse = {
  items: Item[];
  currentPage: number;
  totalItems: number;
  perPage: number;
  totalPages: number;
};
