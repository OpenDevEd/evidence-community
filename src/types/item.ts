export type RelationsType = {
    "dc:relation"?: string | string[];
    "dc:replaces"?: string | string[];
    "owl:sameAs"?: string | string[];
    "related_works"?: string | string[];
    "cited_by"?: number;
    "referenced_works"?: number;
} | undefined;
