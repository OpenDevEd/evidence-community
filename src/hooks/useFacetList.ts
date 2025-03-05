import { inferParserType } from "nuqs";
import { searchParamsLoader } from "@/lib/searchParams";
import { useEffect, useState } from "react";
import { FacetDistribution } from "meilisearch";

export type FacetListItem = {
	key: string;
	label: string;
	description?: string;
	startContent?: React.ReactNode;
	endContent?: React.ReactNode;
};

export function useFacetList(facetDistribution: FacetDistribution, facetName: string, mappingFunction?: (value: string) => FacetListItem) {
    const [facetList, setFacetList] = useState<string[]>([])
    const facet = Object.keys(facetDistribution?.[facetName] || {})

    useEffect(() => {
        setFacetList((prev) => {
            const newFacetList = [...new Set([...prev, ...facet])]
            return newFacetList.sort((a, b) => {
                const aFacet = facetDistribution?.[facetName]?.[a]
                const bFacet = facetDistribution?.[facetName]?.[b]
                return (bFacet || 0) - (aFacet || 0)
            })
        })
    }, [facet])

    return (facetList.length > 0 ? facetList : facet).map(mappingFunction || ((value) => ({key: value, label: value})))
}