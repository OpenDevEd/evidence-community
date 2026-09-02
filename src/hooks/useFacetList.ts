import { inferParserType } from "nuqs";
import { searchParamsLoader } from "@/lib/searchParams";
import { useState, useMemo, useCallback } from "react";
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


// Utility function to efficiently find max value in an object
function getMaxValue(obj: Record<string, number>): number {
    let max = 0;
    for (const value of Object.values(obj)) {
        if (value > max) max = value;
    }
    return max;
}

// Utility function to efficiently merge and deduplicate arrays
function mergeUnique(arr1: string[], arr2: string[]): string[] {
    const seen = new Set(arr1);
    const result = [...arr1];
    
    for (const item of arr2) {
        if (!seen.has(item)) {
            seen.add(item);
            result.push(item);
        }
    }
    return result;
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
    
    // Current facet data - memoized to prevent unnecessary recalculations
    const facetObject = useMemo(() => 
        facetDistribution?.[facetName] || {}, 
        [facetDistribution, facetName]
    );
    
    const currentFacetKeys = useMemo(() => 
        Object.keys(facetObject), 
        [facetObject]
    );
    
    // Create a stable string representation for comparison
    const facetKeysString = useMemo(() => 
        currentFacetKeys.join('|'), 
        [currentFacetKeys]
    );
    
    // Check if facets have hierarchical structure
    const facetHasAncestry = useMemo(() => 
        currentFacetKeys.some((value) => value.includes(" > ")), 
        [currentFacetKeys]
    );
    
    // Memoized sort functions to avoid recreation
    const alphabeticalSort = useCallback((a: string, b: string) => a.localeCompare(b), []);
    
    const countSort = useCallback((a: string, b: string) => {
        const aFacet = facetObject[a] || 0;
        const bFacet = facetObject[b] || 0;
        return bFacet - aFacet;
    }, [facetObject]);
    
    // Default sort function based on behavior - avoid recreation
    const defaultSortFunction = useMemo(() => {
        if (sortFunction) return sortFunction;
        return defaultSortByCount ? countSort : alphabeticalSort;
    }, [sortFunction, defaultSortByCount, countSort, alphabeticalSort]);

    const currentMaxCount = getMaxValue(facetObject);
    const [facetHistory, setFacetHistory] = useState<{
        sourceKeys: string;
        keys: string[];
        count: CategoriesDistribution;
        maxCount: number;
    }>({
        sourceKeys: "",
        keys: [],
        count: {},
        maxCount: 0,
    });
    let activeHistory = facetHistory;

    if (
        stateful &&
        (
            facetKeysString !== facetHistory.sourceKeys ||
            currentMaxCount > facetHistory.maxCount
        )
    ) {
        const keys = mergeUnique(
            facetHistory.keys,
            currentFacetKeys,
        ).sort(defaultSortFunction);
        activeHistory = {
            sourceKeys: facetKeysString,
            keys,
            count:
                currentMaxCount > facetHistory.maxCount
                    ? facetObject
                    : facetHistory.count,
            maxCount: Math.max(currentMaxCount, facetHistory.maxCount),
        };
        setFacetHistory(activeHistory);
    }

    const facetKeys =
        stateful && activeHistory.keys.length > 0
            ? activeHistory.keys
            : currentFacetKeys;
    const activeFacetCount =
        stateful && Object.keys(activeHistory.count).length > 0
            ? activeHistory.count
            : facetObject;
    
         // Default mapping function - memoized to avoid recreation
     const defaultMappingFunction = useCallback(
         (value: string): FacetListItem => ({ key: value, label: value }), 
         []
     );
    
    // Process and map facet list - optimized to reduce object creation
    const mappedFacetList = useMemo(() => {
        if (facetKeys.length === 0) return [];
        
        // Pre-sort the keys to avoid sorting twice
        const sortedKeys = [...facetKeys].sort(defaultSortFunction);
        const mapper = mappingFunction || defaultMappingFunction;
        
        // Single pass through the data to reduce iterations
        const result: FacetListItem[] = [];
        
        for (const key of sortedKeys) {
            const mapped = mapper(key);
            if (mapped === null) continue;
            
            const count = mapped.countKey ? facetObject[mapped.countKey] : facetObject[mapped.key];
            const shouldShowArrow = count > 0 && 
                                  mapped.key.split(" > ").length < 3 && 
                                  facetHasAncestry;
            
            result.push({
                ...mapped,
                showArrow: shouldShowArrow,
                count
            });
        }
        
        return result;
    }, [facetKeys, defaultSortFunction, mappingFunction, defaultMappingFunction, facetObject, facetHasAncestry]);
    
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
