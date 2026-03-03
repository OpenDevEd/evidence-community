import { FacetDistribution } from "meilisearch";
import { ListItem } from "../item/types";

export type ItemsGetResponse = {
  items: ListItem[];
  currentPage: number;
  totalItems: number;
  perPage: number;
  totalPages: number;
  facetDistribution?: FacetDistribution;
};
