import type { Database } from "@/db";
import { item } from "@/db/schema/tables/item";
import { eq, and, desc, sql } from "drizzle-orm";
import { calculateHIndex } from "./utils";
import { visibleItem } from "./utils";
import { citationCountForItem, type CitationMeasure } from "./citation-measure";

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

export async function getCitationStats(
	db: Database,
	measure: CitationMeasure,
	hiddenTags: readonly string[],
): Promise<CitationStats> {
	const citationCount = citationCountForItem(measure, hiddenTags);
	const citationStatsResult = await db
		.select({
			totalItems: sql<number>`count(*)`,
			itemsWithCitations: sql<number>`count(case when ${citationCount} > 0 then 1 end)`,
			totalCitations: sql<number>`coalesce(sum(${citationCount}), 0)`,
			avgCitations: sql<number>`coalesce(avg(${citationCount}), 0)`,
			maxCitations: sql<number>`coalesce(max(${citationCount}), 0)`,
		})
		.from(item)
		.where(
			and(
				visibleItem(db, hiddenTags),
			),
		);

	// Get all citation counts for global H-Index calculation
	const globalCitationCountsResult = await db
		.select({
			citationCount,
		})
		.from(item)
		.where(
			and(
				visibleItem(db, hiddenTags),
			),
		);

	const globalCitationCounts = globalCitationCountsResult.map((row) =>
		Number(row.citationCount || 0),
	);
	const globalHIndex = calculateHIndex(globalCitationCounts);
	
	const totalItems = Number(citationStatsResult[0]?.totalItems || 0);
	const citationStats = {
		totalItems,
		itemsWithCitations: Number(
			citationStatsResult[0]?.itemsWithCitations || 0,
		),
		totalCitations: Number(citationStatsResult[0]?.totalCitations || 0),
		avgCitationsPerItem: Number(citationStatsResult[0]?.avgCitations || 0),
		maxCitations: Number(citationStatsResult[0]?.maxCitations || 0),
		citationPercentage:
			totalItems > 0
				? Number(
						(
							(Number(
								citationStatsResult[0]?.itemsWithCitations || 0,
							) /
								totalItems) *
							100
						).toFixed(2),
					)
				: 0,
		hIndex: globalHIndex,
	};
	
	return citationStats;
}

/** The most cited publications a reader can see, under a citation measure, for the home page's citations preview. */
export async function getMostCitedItems(db: Database, measure: CitationMeasure, limit: number, hiddenTags: readonly string[]) {
	const citationCount = citationCountForItem(measure, hiddenTags);
	const rows = await db
		.select({ key: item.key, title: item.title, citations: citationCount })
		.from(item)
		.where(and(visibleItem(db, hiddenTags), sql`${citationCount} > 0`))
		.orderBy(desc(citationCount))
		.limit(limit);
	return rows.map((row) => ({ key: row.key, title: row.title || row.key, citations: Number(row.citations) }));
}

export async function getCreatorStats(db: Database, hiddenTags: readonly string[]): Promise<CreatorStats> {
	const creatorStatsResult = await db
		.select({
			totalCreators: sql<number>`sum(
				case 
					when ${item.creators} is not null 
					then jsonb_array_length(${item.creators})
					else 0 
				end
			)`,
			avgCreators: sql<number>`avg(
				case 
					when ${item.creators} is not null 
					then jsonb_array_length(${item.creators})
					else 0 
				end
			)`,
			maxCreators: sql<number>`max(
				case 
					when ${item.creators} is not null 
					then jsonb_array_length(${item.creators})
					else 0 
				end
			)`,
		})
		.from(item)
		.where(
			and(
				visibleItem(db, hiddenTags),
			),
		);

	// Calculate global unique authors count
	const globalUniqueAuthorsResult = await db
		.select({
			uniqueAuthors: sql<number>`count(distinct author_name)`,
		})
		.from(
			sql`(
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
			LATERAL jsonb_array_elements(${item.creators}) as creator_data
			WHERE ${visibleItem(db, hiddenTags)}
			AND ${item.creators} IS NOT NULL
			AND jsonb_array_length(${item.creators}) > 0
		) as all_authors`,
		)
		.where(
			sql`author_name IS NOT NULL AND author_name != '' AND author_name != 'Unknown Author'`,
		);

	const creatorStats = {
		totalCreators: Number(creatorStatsResult[0]?.totalCreators || 0),
		uniqueCreators: Number(
			globalUniqueAuthorsResult[0]?.uniqueAuthors || 0,
		),
		avgCreatorsPerItem: Number(creatorStatsResult[0]?.avgCreators || 0),
		maxCreatorsPerItem: Number(creatorStatsResult[0]?.maxCreators || 0),
	};
	
	return creatorStats;
}
