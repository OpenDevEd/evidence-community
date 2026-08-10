import type { Database } from "@/db";
import { item } from "@/db/schema/tables/item";
import { sql, desc } from "drizzle-orm";
import { calculateHIndex } from "./utils";

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

export async function getInstitutionStats(db: Database): Promise<InstitutionStats[]> {
	const institutionStatsResult = await db
		.select({
			institution: sql<string>`institution_name`,
			countryCode: sql<string>`country_code`,
			itemCount: sql<number>`count(*)`,
			totalCitations: sql<number>`coalesce(sum(item_citations), 0)`,
			avgCitationsPerItem: sql<number>`coalesce(avg(item_citations), 0)`,
			citationCounts: sql<number[]>`array_agg(item_citations)`,
		})
		.from(sql`(
			SELECT DISTINCT
				institution_data->>'display_name' as institution_name,
				institution_data->>'country_code' as country_code,
				${item.key} as item_key,
				case 
					when ${item.relations}::jsonb ? 'cited_by' 
					then (${item.relations}::jsonb->>'cited_by')::int 
					else 0 
				end as item_citations
			FROM ${item},
			LATERAL jsonb_array_elements(${item.creators}) as creator_data,
			LATERAL jsonb_array_elements(creator_data->'institutions') as institution_data
			WHERE ${item.deleted} = 0 
			AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
			AND ${item.creators} IS NOT NULL
			AND jsonb_array_length(${item.creators}) > 0
			AND creator_data ? 'institutions'
			AND jsonb_typeof(creator_data->'institutions') = 'array'
			AND jsonb_array_length(creator_data->'institutions') > 0
			AND institution_data ? 'display_name'
			AND institution_data->>'display_name' IS NOT NULL
			AND institution_data->>'display_name' != ''
		) as institution_items`)
		.where(sql`institution_name IS NOT NULL AND institution_name != ''`)
		.groupBy(sql`institution_name, country_code`)
		.orderBy(desc(sql`count(*)`));
	
	return institutionStatsResult.map(stat => ({
		institution: stat.institution?.trim() || '',
		countryCode: stat.countryCode || '',
		itemCount: Number(stat.itemCount),
		totalCitations: Number(stat.totalCitations),
		avgCitationsPerItem: Number(stat.avgCitationsPerItem),
		hIndex: calculateHIndex(stat.citationCounts?.map(c => Number(c)) || [])
	}));
}

export async function getInstitutionStatsByYear(db: Database): Promise<InstitutionYearStats[]> {
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
		.from(sql`(
			SELECT
				institution_data->>'display_name' as institution_name,
				institution_data->>'country_code' as country_code,
				extract(year from 
					case 
						when item_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' 
						then to_date(item_date, 'YYYY-MM-DD')
						else null
					end
				)::text as year_extracted,
				item_key,
				case 
					when item_relations::jsonb ? 'cited_by' 
					then (item_relations::jsonb->>'cited_by')::int 
					else 0 
				end as item_citations
			FROM (
				SELECT DISTINCT
					${item.key} as item_key,
					${item.date} as item_date,
					${item.relations} as item_relations,
					creator_data,
					institution_data
				FROM ${item},
				LATERAL jsonb_array_elements(${item.creators}) as creator_data,
				LATERAL jsonb_array_elements(creator_data->'institutions') as institution_data
				WHERE ${item.deleted} = 0 
				AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
				AND ${item.creators} IS NOT NULL
				AND jsonb_array_length(${item.creators}) > 0
				AND creator_data ? 'institutions'
				AND jsonb_typeof(creator_data->'institutions') = 'array'
				AND jsonb_array_length(creator_data->'institutions') > 0
				AND institution_data ? 'display_name'
				AND institution_data->>'display_name' IS NOT NULL
				AND institution_data->>'display_name' != ''
				AND ${item.date} IS NOT NULL
				AND ${item.date} != ''
				AND ${item.date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
			) as items_with_institutions
		) as institution_year_items`)
		.where(sql`institution_name IS NOT NULL AND institution_name != '' AND year_extracted IS NOT NULL`)
		.groupBy(sql`institution_name, country_code, year_extracted`)
		.orderBy(desc(sql`year_extracted::int`), desc(sql`count(distinct item_key)`));
	
	return institutionsByYearResult.map(stat => ({
		institution: stat.institution?.trim() || '',
		countryCode: stat.countryCode || '',
		year: stat.year || '',
		itemCount: Number(stat.itemCount),
		totalCitations: Number(stat.totalCitations),
		avgCitationsPerItem: Number(stat.avgCitationsPerItem),
		hIndex: calculateHIndex(stat.citationCounts?.map(c => Number(c)) || [])
	}));
}
