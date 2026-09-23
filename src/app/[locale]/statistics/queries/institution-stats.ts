import type { Database } from "@/db";
import { item } from "@/db/schema/tables/item";
import { itemInstitution } from "@/db/schema/tables/itemInstitution";
import { sql, desc, type SQL } from "drizzle-orm";
import {
	institutionCountryCode,
	institutionCountryJoin,
} from "./institution-country-sql";
import { calculateHIndex, yearOf } from "./utils";
import { citationCountForItem, type CitationMeasure } from "./citation-measure";

export type InstitutionStats = {
	institution: string;
	countryCode: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
};

export type InstitutionYearStats = {
	institution: string;
	countryCode: string;
	year: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
};

function citationSummary(stat: {
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	citationCounts: number[];
}) {
	return {
		itemCount: Number(stat.itemCount),
		totalCitations: Number(stat.totalCitations),
		avgCitationsPerItem: Number(stat.avgCitationsPerItem),
		hIndex: calculateHIndex(
			stat.citationCounts?.map((count) => Number(count)) || [],
		),
	};
}

/**
 * One row for each record and institution connected to it: the record's own
 * institutions and its authors' affiliations, read from the projection.
 * DISTINCT keeps an institution named in both places to one row.
 */
function institutionItems(citationCount: SQL) {
	return sql`(
			SELECT DISTINCT
				${itemInstitution.institutionName} as institution_name,
				${institutionCountryCode} as country_code,
				${item.key} as item_key,
				${item.date} as item_date,
				${citationCount} as item_citations
			FROM ${itemInstitution}
			JOIN ${item} ON ${item.key} = ${itemInstitution.itemKey}
			${institutionCountryJoin(sql`${itemInstitution.institutionName}`)}
		)`;
}

export async function getInstitutionStats(
	db: Database,
	measure: CitationMeasure,
): Promise<InstitutionStats[]> {
	const citationCount = citationCountForItem(measure);
	const institutionStatsResult = await db
		.select({
			institution: sql<string>`institution_name`,
			countryCode: sql<string>`country_code`,
			itemCount: sql<number>`count(*)`,
			totalCitations: sql<number>`coalesce(sum(item_citations), 0)`,
			avgCitationsPerItem: sql<number>`coalesce(avg(item_citations), 0)`,
			citationCounts: sql<number[]>`array_agg(item_citations)`,
		})
		.from(sql`${institutionItems(citationCount)} as institution_items`)
		.where(sql`institution_name IS NOT NULL AND institution_name != ''`)
		.groupBy(sql`institution_name, country_code`)
		.orderBy(desc(sql`count(*)`));
	
	return institutionStatsResult.map((stat) => ({
		institution: stat.institution?.trim() || "",
		countryCode: stat.countryCode || "",
		...citationSummary(stat),
	}));
}

export async function getInstitutionStatsByYear(
	db: Database,
	measure: CitationMeasure,
): Promise<InstitutionYearStats[]> {
	const citationCount = citationCountForItem(measure);
	const institutionsByYearResult = await db
		.select({
			institution: sql<string>`institution_name`,
			countryCode: sql<string>`country_code`,
			year: sql<string>`year_extracted`,
			itemCount: sql<number>`count(distinct item_key)`,
			totalCitations: sql<number>`coalesce(sum(item_citations), 0)`,
			avgCitationsPerItem: sql<number>`coalesce(avg(item_citations), 0)`,
			citationCounts: sql<number[]>`array_agg(item_citations)`,
		})
		.from(
			sql`(
			SELECT
				institution_name,
				country_code,
				${yearOf(sql.raw("item_date"))}::text as year_extracted,
				item_key,
				item_citations
			FROM ${institutionItems(citationCount)} as institution_items
			WHERE item_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
		) as institution_year_items`,
		)
		.where(
			sql`institution_name IS NOT NULL AND institution_name != '' AND year_extracted IS NOT NULL`,
		)
		.groupBy(sql`institution_name, country_code, year_extracted`)
		.orderBy(
			desc(sql`year_extracted::int`),
			desc(sql`count(distinct item_key)`),
		);
	
	return institutionsByYearResult.map((stat) => ({
		institution: stat.institution?.trim() || "",
		countryCode: stat.countryCode || "",
		year: stat.year || "",
		...citationSummary(stat),
	}));
}
