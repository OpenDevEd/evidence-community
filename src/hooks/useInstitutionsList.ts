import { inferParserType } from "nuqs";
import { searchParamsLoader } from "@/lib/searchParams";
import { useEffect, useState } from "react";
import { FacetDistribution } from "meilisearch";
export function useInstitutionsList(facetDistribution: FacetDistribution) {
    const [institutions, setInstitutions] = useState<string[]>([])
    const facetInstitutions = Object.keys(facetDistribution?.institution || {})

    useEffect(() => {
        setInstitutions((prev) => {
            const newInstitutions = [...new Set([...prev, ...facetInstitutions])]
            return newInstitutions.sort((a, b) => {
                const aInstitution = facetDistribution?.institution?.[a]
                const bInstitution = facetDistribution?.institution?.[b]
                return (bInstitution || 0) - (aInstitution || 0)
            })
        })
    }, [facetInstitutions])

    return institutions.length > 0 ? institutions : facetInstitutions
}