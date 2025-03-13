import { inferParserType } from "nuqs";
import { searchParamsLoader } from "@/lib/searchParams";
import { useEffect, useState } from "react";
import { CategoriesDistribution, FacetDistribution } from "meilisearch";

export type FacetListItem = {
	key: string;
	label: string;
	description?: string;
	startContent?: React.ReactNode;
	endContent?: React.ReactNode;
};

export function useFacetList(facetDistribution: FacetDistribution, facetName: string, mappingFunction?: (value: string) => FacetListItem): [FacetListItem[], CategoriesDistribution] {
    const [facetList, setFacetList] = useState<string[]>([])
    const [facetCount, setFacetCount] = useState<CategoriesDistribution | null>(null)
    const facetObject = facetDistribution?.[facetName] || {}
    const facet = Object.keys(facetObject)

    const mappedFacetList = (facetList.length > 0 ? facetList : facet).map(mappingFunction || ((value) => ({key: value, label: value})))

    useEffect(() => {
        setFacetList((prev) => {
            const newFacetList = [...new Set([...prev, ...facet])]
            return newFacetList.sort((a, b) => {
                const aFacet = facetDistribution?.[facetName]?.[a]
                const bFacet = facetDistribution?.[facetName]?.[b]
                return (bFacet || 0) - (aFacet || 0)
            })
        })
        if (!facetCount || Object.keys(facetCount).length === 0 || Math.max(...Object.values(facetCount)) < Math.max(...Object.values(facetObject))) {
            setFacetCount(facetObject);
        }
    }, [facet])

    return [mappedFacetList || [], facetCount || {}]
}