import { item } from "@/db/schema/tables/item";
import { getTableColumns } from "drizzle-orm";

export const ITEMS_PER_PAGE = 20;

export const EXCLUDED_ITEM_TYPES = ["Note", "Attachment"];

export const SORT_OPTIONS = [
  { key: "desc", name: "Newest", sort: "dateAdded:desc" },
  { key: "asc", name: "Oldest", sort: "dateAdded:asc" },
  { key: "authorAZ", name: "Author A-Z", sort: "creators.firstName:asc" },
  { key: "authorZA", name: "Author Z-A", sort: "creators.firstName:desc" },
  { key: "titleAZ", name: "Title A-Z", sort: "title:asc" },
  { key: "titleZA", name: "Title Z-A", sort: "title:desc" },
];

export const ITEM_COLUMNS = Object.values(getTableColumns(item)).map((col: any) => col.name);

export const SCOPE_OPTIONS = [
  { key: "everywhere", name: "Everywhere", attributesToSearchOn: ["*"] },
  { key: "authors", name: "in authors or contributors", attributesToSearchOn: ["creators.firstName", "creators.lastName"] },
  { key: "title", name: "in title", attributesToSearchOn: ["title"] },
  { key: "fields", name: "in fields", attributesToSearchOn: ITEM_COLUMNS.filter((col) => col !== "fullTextPDF" && col !== "items") },
  { key: "documents", name: "in documents", attributesToSearchOn: ["fullTextPDF", "items.fullTextPDF"] },
];
