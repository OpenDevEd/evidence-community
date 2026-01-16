import { db } from "@/db";
import { item } from "@/db/schema/tables/item";
import { eq, and, sql } from "drizzle-orm";
import { calculateHIndex } from "./utils";

export type CitationStats = {
	totalItems: number;
	itemsWithCitations: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	maxCitations: number;
	citationPercentage: number;
	hIndex: number;
};

export type CreatorStats = {
	totalCreators: number;
	uniqueCreators: number;
	avgCreatorsPerItem: number;
	maxCreatorsPerItem: number;
};

export async function getCitationStats(): Promise<CitationStats> {	
	const citationStatsResult = await db
		.select({
			totalItems: sql<number>`count(*)`,
			itemsWithCitations: sql<number>`count(case when ${item.relations}::jsonb ? 'cited_by' and (${item.relations}::jsonb->>'cited_by')::int > 0 then 1 end)`,
			totalCitations: sql<number>`coalesce(sum(case when ${item.relations}::jsonb ? 'cited_by' then (${item.relations}::jsonb->>'cited_by')::int else 0 end), 0)`,
			avgCitations: sql<number>`coalesce(avg(case when ${item.relations}::jsonb ? 'cited_by' then (${item.relations}::jsonb->>'cited_by')::int else 0 end), 0)`,
			maxCitations: sql<number>`coalesce(max(case when ${item.relations}::jsonb ? 'cited_by' then (${item.relations}::jsonb->>'cited_by')::int else 0 end), 0)`
		})
		.from(item)
		.where(
			and(
				eq(item.deleted, 0),
				sql`${item.parentItem} IS NULL OR ${item.parentItem} = ''`
			)
		);

	// Get all citation counts for global H-Index calculation
	const globalCitationCountsResult = await db
		.select({
			citationCount: sql<number>`case when ${item.relations}::jsonb ? 'cited_by' then (${item.relations}::jsonb->>'cited_by')::int else 0 end`
		})
		.from(item)
		.where(
			and(
				eq(item.deleted, 0),
				sql`${item.parentItem} IS NULL OR ${item.parentItem} = ''`
			)
		);

	const globalCitationCounts = globalCitationCountsResult.map(row => Number(row.citationCount || 0));
	const globalHIndex = calculateHIndex(globalCitationCounts);
	
	const totalItems = Number(citationStatsResult[0]?.totalItems || 0);
	const citationStats = {
		totalItems,
		itemsWithCitations: Number(citationStatsResult[0]?.itemsWithCitations || 0),
		totalCitations: Number(citationStatsResult[0]?.totalCitations || 0),
		avgCitationsPerItem: Number(citationStatsResult[0]?.avgCitations || 0),
		maxCitations: Number(citationStatsResult[0]?.maxCitations || 0),
		citationPercentage: totalItems > 0 ? Number(((Number(citationStatsResult[0]?.itemsWithCitations || 0) / totalItems) * 100).toFixed(2)) : 0,
		hIndex: globalHIndex
	};
	
	
	return citationStats;
}

export async function getCreatorStats(): Promise<CreatorStats> {	
	const creatorStatsResult = await db
		.select({
			totalCreators: sql<number>`sum(
				case 
					when ${item.creators} is not null 
					then array_length(${item.creators}, 1) 
					else 0 
				end
			)`,
			avgCreators: sql<number>`avg(
				case 
					when ${item.creators} is not null 
					then array_length(${item.creators}, 1) 
					else 0 
				end
			)`,
			maxCreators: sql<number>`max(
				case 
					when ${item.creators} is not null 
					then array_length(${item.creators}, 1) 
					else 0 
				end
			)`
		})
		.from(item)
		.where(
			and(
				eq(item.deleted, 0),
				sql`${item.parentItem} IS NULL OR ${item.parentItem} = ''`
			)
		);

	// Calculate global unique authors count
	const globalUniqueAuthorsResult = await db
		.select({
			uniqueAuthors: sql<number>`count(distinct author_name)`
		})
		.from(sql`(
			SELECT DISTINCT
				coalesce(
					nullif(trim(
						coalesce(creator_data->>'firstName', '') || 
						case when creator_data->>'firstName' is not null and creator_data->>'lastName' is not null then ' ' else '' end ||
						coalesce(creator_data->>'lastName', '')
					), ''),
					nullif(trim(creator_data->>'name'), ''),
					'Unknown Author'
				) as author_name
			FROM ${item},
			LATERAL unnest(${item.creators}) as creator_data
			WHERE ${item.deleted} = 0 
			AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
			AND ${item.creators} IS NOT NULL
			AND array_length(${item.creators}, 1) > 0
		) as all_authors`)
		.where(sql`author_name IS NOT NULL AND author_name != '' AND author_name != 'Unknown Author'`);

	const creatorStats = {
		totalCreators: Number(creatorStatsResult[0]?.totalCreators || 0),
		uniqueCreators: Number(globalUniqueAuthorsResult[0]?.uniqueAuthors || 0),
		avgCreatorsPerItem: Number(creatorStatsResult[0]?.avgCreators || 0),
		maxCreatorsPerItem: Number(creatorStatsResult[0]?.maxCreators || 0)
	};
	
	return creatorStats;
} 