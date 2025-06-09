import { inferParserType } from "nuqs";
import { searchParamsLoader } from "@/lib/searchParams";
import { useEffect, useState, useMemo } from "react";
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

/**
 * Unified facet list hook that handles both stateful and stateless behaviors
 * @param facetDistribution - The facet distribution data from search results
 * @param facetName - The name of the facet to process
 * @param options - Configuration options for behavior
 * @param mappingFunction - Optional function to transform facet values to FacetListItem
 * @param sortFunction - Optional custom sorting function
 */
function useFacetListUnified(
    facetDistribution: FacetDistribution, 
    facetName: string, 
    options: {
        stateful?: boolean;
        defaultSortByCount?: boolean;
    } = {},
    mappingFunction?: (value: string) => FacetListItem | null, 
    sortFunction?: (a: string, b: string) => number
): useFacetListReturn {
    const { stateful = false, defaultSortByCount = false } = options;
    
    // Current facet data
    const facetObject = facetDistribution?.[facetName] || {}
    const currentFacetKeys = Object.keys(facetObject)
    
    // State for accumulated facets (only for stateful behavior)
    const [accumulatedState, setAccumulatedState] = useState<{
        facetList: string[];
        facetCount: CategoriesDistribution;
    }>(() => ({
        facetList: [],
        facetCount: {}
    }));
    
    // Update accumulated state when new facets arrive (only for stateful behavior)
    const updatedAccumulatedState = useMemo(() => {
        if (!stateful) {
            return { facetList: currentFacetKeys, facetCount: facetObject };
        }
        
        // Check if we need to update the accumulated state
        const hasNewFacets = currentFacetKeys.some(key => !accumulatedState.facetList.includes(key));
        const currentMaxCount = currentFacetKeys.length > 0 ? Math.max(...Object.values(facetObject)) : 0;
        const existingMaxCount = Object.keys(accumulatedState.facetCount).length > 0 ? Math.max(...Object.values(accumulatedState.facetCount)) : 0;
        const shouldUpdateCount = Object.keys(accumulatedState.facetCount).length === 0 || existingMaxCount < currentMaxCount;
        
        if (hasNewFacets || shouldUpdateCount) {
            const newState = {
                facetList: hasNewFacets ? [...new Set([...accumulatedState.facetList, ...currentFacetKeys])] : accumulatedState.facetList,
                facetCount: shouldUpdateCount ? facetObject : accumulatedState.facetCount
            };
            
            // Update state asynchronously to avoid infinite loops
            setTimeout(() => setAccumulatedState(newState), 0);
            
            return newState;
        }
        
        return accumulatedState;
    }, [stateful, currentFacetKeys, facetObject, accumulatedState]);
    
    // Determine which facet keys and counts to use
    const { facetKeys, activeFacetCount } = useMemo(() => {
        if (!stateful) {
            return {
                facetKeys: currentFacetKeys,
                activeFacetCount: facetObject
            };
        }
        
        const keys = updatedAccumulatedState.facetList.length > 0 ? updatedAccumulatedState.facetList : currentFacetKeys;
        const counts = updatedAccumulatedState.facetCount;
        
        return {
            facetKeys: keys,
            activeFacetCount: counts
        };
    }, [stateful, currentFacetKeys, facetObject, updatedAccumulatedState]);
    
    // Check if facets have hierarchical structure
    const facetHasAncestry = useMemo(() => 
        currentFacetKeys.some((value) => value.includes(" > ")), 
        [currentFacetKeys]
    );
    
    // Default sort function based on behavior
    const defaultSortFunction = useMemo(() => {
        if (sortFunction) return sortFunction;
        
        if (defaultSortByCount) {
            return (a: string, b: string) => {
                const aFacet = facetDistribution?.[facetName]?.[a] || 0;
                const bFacet = facetDistribution?.[facetName]?.[b] || 0;
                return bFacet - aFacet;
            };
        }
        
        return (a: string, b: string) => a.localeCompare(b);
    }, [sortFunction, defaultSortByCount, facetDistribution, facetName]);
    
    // Process and map facet list
    const mappedFacetList = useMemo(() => {
        const sortedKeys = [...facetKeys].sort(defaultSortFunction);
        
        return sortedKeys
            .map(mappingFunction || ((value) => ({ key: value, label: value })))
            .filter((item): item is FacetListItem => item !== null)
            .map((item: FacetListItem) => ({
                ...item,
                showArrow: facetObject[item.key] > 0 && 
                          item.key.split(" > ").length < 3 && 
                          facetHasAncestry,
                count: item.countKey ? facetObject[item.countKey] : facetObject[item.key]
            }));
    }, [facetKeys, defaultSortFunction, mappingFunction, facetObject, facetHasAncestry]);
    
    return [mappedFacetList, activeFacetCount];
}

export function useFacetListRaw(
    facetDistribution: FacetDistribution, 
    facetName: string, 
    mappingFunction?: (value: string) => FacetListItem | null, 
    sortFunction?: (a: string, b: string) => number
): useFacetListReturn {
    return useFacetListUnified(
        facetDistribution, 
        facetName, 
        { stateful: false, defaultSortByCount: false }, 
        mappingFunction, 
        sortFunction
    );
}

export function useFacetList(
    facetDistribution: FacetDistribution, 
    facetName: string, 
    mappingFunction?: (value: string) => FacetListItem | null, 
    sortFunction?: (a: string, b: string) => number
): useFacetListReturn {
    return useFacetListUnified(
        facetDistribution, 
        facetName, 
        { stateful: true, defaultSortByCount: true }, 
        mappingFunction, 
        sortFunction
    );
}