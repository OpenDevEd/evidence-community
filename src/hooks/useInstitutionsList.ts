import { inferParserType } from "nuqs";
import { searchParamsLoader } from "@/lib/searchParams";
import { useEffect, useState } from "react";
import { FacetDistribution } from "meilisearch";
export function useInstitutionsList(facetDistribution: FacetDistribution) {
    const [institutions, setInstitutions] = useState<string[]>([])
    const facetInstitutions = Object.keys(facetDistribution?.institution || {})

    useEffect(() => {
        setInstitutions((prev) => [...new Set([...prev, ...facetInstitutions])])
    }, [facetInstitutions])

    return institutions.length > 0 ? institutions : facetInstitutions
}