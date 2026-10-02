import { FacetDistribution } from "meilisearch";

export type FacetsGetResponse = {
  facetDistribution: FacetDistribution;
  /** How many results each facet's counts are out of; `*` for the filtered results. */
  totals: Record<string, number>;
};
