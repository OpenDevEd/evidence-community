import { ListItem } from "../item/types";

export type ItemsGetResponse = {
  items: ListItem[];
  currentPage: number;
  totalItems: number;
  perPage: number;
  totalPages: number;
  /**
   * Where the pages next to this one start, for pages past the numbered ones (`after` and `before`). A reader's own
   * list has no such pages.
   */
  cursors?: { previous: string | null; next: string | null };
};
