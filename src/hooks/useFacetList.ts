import { inferParserType } from "nuqs";
import { searchParamsLoader } from "@/lib/searchParams";
import { useEffect, useState } from "react";
import { CategoriesDistribution, FacetDistribution } from "meilisearch";

export type FacetListItem = {
    key: string;
    countKey?: string;
    label: string;
    description?: string;
    startContent?: React.ReactNode;
    endContent?: React.ReactNode;
    style?: React.CSSProperties;
    showArrow?: boolean;
    hideCount?: boolean;
    count?: number;
    query?: string | string[];
    onSelectionChange?: (value: any | null) => void;
    section?: string;
    hide?: boolean;
    isSelected?: boolean;
};

type useFacetListReturn = [FacetListItem[], CategoriesDistribution]

export function useMultipleFacetLists(...args: useFacetListReturn[]): useFacetListReturn {
    const allItems = args.map((item) => item[0]).flat()
    const allFacetCounts = Object.assign({}, ...args.map(item => item[1]))
    return [allItems, allFacetCounts]
}

export function useFacetListRaw(facetDistribution: FacetDistribution, facetName: string, mappingFunction?: (value: string) => FacetListItem | null, sortFunction?: (a: string, b: string) => number): useFacetListReturn {
    const facetObject = facetDistribution?.[facetName] || {}
    const facet = Object.keys(facetObject)
    const facetHasAncestry = facet.some((value) => value.includes(" > "))
    const mappedFacetList = facet.sort(sortFunction || ((a, b) => {
        return a.localeCompare(b)
    })).map(mappingFunction || ((value) => ({ key: value, label: value }))).filter((item) => item !== null).map((item: FacetListItem) => ({
        ...item,
        showArrow: facetObject[item.key] > 0 && item.key.split(" > ").length < 3 && facetHasAncestry,
        count: item.countKey ? facetObject[item.countKey] : facetObject[item.key]
    }))

    return [mappedFacetList, facetObject]
}

export function useFacetList(facetDistribution: FacetDistribution, facetName: string, mappingFunction?: (value: string) => FacetListItem | null, sortFunction?: (a: string, b: string) => number): useFacetListReturn {
    const [facetList, setFacetList] = useState<string[]>([])
    const [facetCount, setFacetCount] = useState<CategoriesDistribution | null>(null)
    const facetObject = facetDistribution?.[facetName] || {}
    const facet = Object.keys(facetObject)
    const facetHasAncestry = facet.some((value) => value.includes(" > "))

    const mappedFacetList = (facetList.length > 0 ? facetList : facet).map(mappingFunction || ((value) => ({ key: value, label: value }))).filter((item) => item !== null).map((item: FacetListItem) => ({
        ...item,
        showArrow: facetObject[item.key] > 0 && item.key.split(" > ").length < 3 && facetHasAncestry,
        count: item.countKey ? facetObject[item.countKey] : facetObject[item.key]
    }))

    useEffect(() => {
        setFacetList((prev) => {
            const newFacetList = [...new Set([...prev, ...facet])]
            return newFacetList.sort(sortFunction || ((a, b) => {
                const aFacet = facetDistribution?.[facetName]?.[a]
                const bFacet = facetDistribution?.[facetName]?.[b]
                return (bFacet || 0) - (aFacet || 0)
            }))
        })
        if (!facetCount || Object.keys(facetCount).length === 0 || Math.max(...Object.values(facetCount)) < Math.max(...Object.values(facetObject))) {
            setFacetCount(facetObject);
        }
    }, [facet])

    return [mappedFacetList || [], facetCount || {}]
}