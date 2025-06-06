import { db } from "@/db";
import { item } from "@/db/schema/tables/item";
import { eq, isNotNull, and, ne, sql, desc, gte, lte } from "drizzle-orm";
import StatisticsPage from "@/components/layout/StatisticsPage";
import { unstable_cache } from "next/cache";
import meilisearch from "@/lib/meilisearch";
import { COUNTRIES } from "@/constants/misc";
import { getCachedStatus } from "@/app/api/cache";
import { PiLinkSimpleDuotone } from "react-icons/pi";
import { notFound } from "next/navigation";

export const maxDuration = 300;

// Helper function to calculate H-Index from citation counts
function calculateHIndex(citationCounts: number[]): number {
	if (citationCounts.length === 0) return 0;
	
	// Sort citation counts in descending order
	const sortedCitations = citationCounts.sort((a, b) => b - a);
	
	let hIndex = 0;
	for (let i = 0; i < sortedCitations.length; i++) {
		// H-Index is the largest number h such that h publications have at least h citations each
		const currentRank = i + 1; // 1-indexed rank
		const currentCitations = sortedCitations[i];
		
		if (currentCitations >= currentRank) {
			hIndex = currentRank;
		} else {
			break;
		}
	}
	
	return hIndex;
}

type InstitutionStats = {
	institution: string;
	countryCode: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
};

type InstitutionYearStats = {
	institution: string;
	countryCode: string;
	year: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
};

type ItemTypeStats = {
	itemType: string;
	count: number;
	percentage: number;
};

type YearStats = {
	year: string;
	count: number;
};

type CitationStats = {
	totalItems: number;
	itemsWithCitations: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	maxCitations: number;
	citationPercentage: number;
	hIndex: number;
};

type CreatorStats = {
	totalCreators: number;
	uniqueCreators: number;
	avgCreatorsPerItem: number;
	maxCreatorsPerItem: number;
};

type FieldStats = {
	field: string;
	filledCount: number;
	percentage: number;
};

type AttachmentStats = {
	totalAttachments: number;
	itemsWithAttachments: number;
	attachmentPercentage: number;
};

type AuthorCountryStats = {
	countryCode: string;
	countryName: string;
	authorCount: number;
	itemCount: number;
	hIndex: number;
};

type AuthorStats = {
	authorName: string;
	firstName: string;
	lastName: string;
	displayName: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
	countryCount: number;
	institutionCount: number;
	creatorTypes: string[];
	mostCommonCreatorType: string;
	countries: string[];
	institutions: string[];
	firstPublicationYear: number;
	lastPublicationYear: number;
	yearSpan: number;
	mostRecentYear: number;
};

type AuthorProductivityStats = {
	totalAuthors: number;
	authorsWithMultipleWorks: number;
	avgItemsPerAuthor: number;
	maxItemsPerAuthor: number;
	productivityDistribution: {
		range: string;
		count: number;
		percentage: number;
	}[];
};

type AuthorCollaborationStats = {
	soloAuthors: number;
	collaborativeAuthors: number;
	avgCollaboratorsPerAuthor: number;
	maxCollaboratorsPerAuthor: number;
	collaborationRate: number;
};

type CollaborationStats = {
	totalItems: number;
	collaborativeItems: number;
	overallCollaborationRate: number;
	baseCountry: {
		countryCode: string;
		countryName: string;
		totalItems: number;
		collaborativeItems: number;
		collaborationRate: number;
	};
	countryCollaborationRates: {
		countryCode: string;
		countryName: string;
		totalItems: number;
		// All international collaborations (including with base country)
		internationalItems: number;
		internationalRate: number;
		// International collaborations excluding base country
		independentItems: number;
		independentRate: number;
		// Domestic/solo publications (no international collaboration)
		domesticItems: number;
		domesticRate: number;
	}[];
	topCollaborations: {
		country1: string;
		country2: string;
		country1Name: string;
		country2Name: string;
		collaborationCount: number;
	}[];
	collaborationMatrix: {
		[key: string]: {
			[key: string]: number;
		};
	};
};

type TopicStats = {
	topic: string;
	level: number;
	parentTopic?: string;
	fullPath: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
	isLeaf: boolean;
	children: string[];
};

type TopicOverview = {
	totalTopics: number;
	maxDepth: number;
	topLevelTopics: number;
	avgItemsPerTopic: number;
	topicDistribution: {
		level: number;
		count: number;
		percentage: number;
	}[];
};

type ComprehensiveStats = {
	institutions: InstitutionStats[];
	institutionsByYear: InstitutionYearStats[];
	availableYears: string[];
	itemTypes: ItemTypeStats[];
	yearDistribution: YearStats[];
	citationStats: CitationStats;
	creatorStats: CreatorStats;
	fieldCompleteness: FieldStats[];
	attachmentStats: AttachmentStats;
	authorCountries: AuthorCountryStats[];
	collaborationStats: CollaborationStats;
	authorStats: AuthorStats[];
	authorProductivityStats: AuthorProductivityStats;
	authorCollaborationStats: AuthorCollaborationStats;
	topPublishers: { publisher: string; count: number }[];
	topJournals: { journal: string; count: number }[];
	languageDistribution: { language: string; count: number }[];
	recentActivity: { date: string; count: number }[];
	topicStats: TopicStats[];
	topicOverview: TopicOverview;
};

async function getComprehensiveStats(ignore: boolean): Promise<ComprehensiveStats> {
	const index = "cache";
	const documentId = process.env.MEILI_INDEX + "-comprehensive-stats";

	try {
		if (ignore) {
			throw new Error("Ignore");
		}
		console.log("📊 Checking cached statistics...");
		const statsResult = await meilisearch
			.index(index)
			.getDocument(documentId);
		console.log("✅ Found cached statistics");
		return JSON.parse(statsResult.content);
	} catch (error) {
		console.log("🔄 No cached statistics found, generating fresh data...");
		const indexCreation = await meilisearch.createIndex(index);
		await meilisearch.waitForTask(indexCreation.taskUid);

		// Get institution stats with citation data for H-Index calculation (FIXED: proper citation aggregation)
		console.log("🏛️  Query 1/15: Fetching institution statistics...");
		const startTime1 = Date.now();
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
				LATERAL unnest(${item.creators}) as creator_data,
				LATERAL jsonb_array_elements(creator_data->'institutions') as institution_data
				WHERE ${item.deleted} = 0 
				AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
				AND ${item.creators} IS NOT NULL
				AND array_length(${item.creators}, 1) > 0
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
		console.log(`✅ Query 1 completed in ${Date.now() - startTime1}ms (${institutionStatsResult.length} institutions)`);

		// Get institution stats by year for client-side filtering (FIXED: proper citation aggregation)
		console.log("📅 Query 2/15: Fetching institution statistics by year...");
		const startTime2 = Date.now();
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
					LATERAL unnest(${item.creators}) as creator_data,
					LATERAL jsonb_array_elements(creator_data->'institutions') as institution_data
					WHERE ${item.deleted} = 0 
					AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
					AND ${item.creators} IS NOT NULL
					AND array_length(${item.creators}, 1) > 0
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
		console.log(`✅ Query 2 completed in ${Date.now() - startTime2}ms (${institutionsByYearResult.length} institution-year records)`);

		// Get available years for filtering (only years with significant data)
		console.log("🗓️  Query 3/15: Fetching available years...");
		const startTime3 = Date.now();
		const availableYearsResult = await db
			.select({
				year: sql<string>`extract(year from 
					case 
						when ${item.date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' 
						then to_date(${item.date}, 'YYYY-MM-DD')
						else null
					end
				)::text`,
				count: sql<number>`count(*)`
			})
			.from(item)
			.where(
				and(
					eq(item.deleted, 0),
					isNotNull(item.date),
					ne(item.date, ''),
					sql`${item.parentItem} IS NULL OR ${item.parentItem} = ''`,
					sql`${item.date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'` // Only valid date format
				)
			)
			.groupBy(sql`extract(year from 
				case 
					when ${item.date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' 
					then to_date(${item.date}, 'YYYY-MM-DD')
					else null
				end
			)`)
			.having(sql`count(*) >= 10`) // Only include years with at least 10 publications
			.orderBy(desc(sql`extract(year from 
				case 
					when ${item.date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' 
					then to_date(${item.date}, 'YYYY-MM-DD')
					else null
				end
			)`))
			.limit(20); // Limit to last 20 years with data
		console.log(`✅ Query 3 completed in ${Date.now() - startTime3}ms (${availableYearsResult.length} years with data)`);

		// Get total items count (excluding attachments)
		console.log("📊 Query 4/15: Counting total items...");
		const startTime4 = Date.now();
		const totalItemsResult = await db
			.select({ count: sql<number>`count(*)` })
			.from(item)
			.where(
				and(
					eq(item.deleted, 0),
					sql`${item.parentItem} IS NULL OR ${item.parentItem} = ''`
				)
			);
		const totalItems = totalItemsResult[0]?.count || 0;
		console.log(`✅ Query 4 completed in ${Date.now() - startTime4}ms (${totalItems.toLocaleString()} total items)`);

		// Get item type distribution
		console.log("📋 Query 5/15: Fetching item type distribution...");
		const startTime5 = Date.now();
		const itemTypeStatsResult = await db
			.select({
				itemType: item.itemType,
				count: sql<number>`count(*)`
			})
			.from(item)
			.where(
				and(
					eq(item.deleted, 0),
					sql`${item.parentItem} IS NULL OR ${item.parentItem} = ''`
				)
			)
			.groupBy(item.itemType)
			.orderBy(desc(sql`count(*)`));

		const itemTypes = itemTypeStatsResult.map(stat => ({
			itemType: stat.itemType,
			count: Number(stat.count),
			percentage: totalItems > 0 ? Number(((Number(stat.count) / totalItems) * 100).toFixed(2)) : 0
		}));
		console.log(`✅ Query 5 completed in ${Date.now() - startTime5}ms (${itemTypes.length} item types)`);

		// Get year distribution
		console.log("📈 Query 6/15: Fetching year distribution...");
		const startTime6 = Date.now();
		const yearStatsResult = await db
			.select({
				year: sql<string>`extract(year from 
					case 
						when ${item.date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' 
						then to_date(${item.date}, 'YYYY-MM-DD')
						else null
					end
				)::text`,
				count: sql<number>`count(*)`
			})
			.from(item)
			.where(
				and(
					eq(item.deleted, 0),
					isNotNull(item.date),
					ne(item.date, ''),
					sql`${item.parentItem} IS NULL OR ${item.parentItem} = ''`,
					sql`${item.date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'` // Only valid date format
				)
			)
			.groupBy(sql`extract(year from 
				case 
					when ${item.date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' 
					then to_date(${item.date}, 'YYYY-MM-DD')
					else null
				end
			)`)
			.orderBy(desc(sql`extract(year from 
				case 
					when ${item.date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' 
					then to_date(${item.date}, 'YYYY-MM-DD')
					else null
				end
			)`))
			.limit(20);
		console.log(`✅ Query 6 completed in ${Date.now() - startTime6}ms (${yearStatsResult.length} years)`);

		// Get citation statistics
		console.log("📊 Query 7/15: Calculating citation statistics...");
		const startTime7 = Date.now();
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
		console.log(`✅ Query 7 completed in ${Date.now() - startTime7}ms`);

		// Get all citation counts for global H-Index calculation
		console.log("🏆 Query 8/15: Fetching citation counts for global H-Index...");
		const startTime8 = Date.now();
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
		console.log(`✅ Query 8 completed in ${Date.now() - startTime8}ms (Global H-Index: ${globalHIndex})`);

		const citationStats = {
			totalItems: Number(citationStatsResult[0]?.totalItems || 0),
			itemsWithCitations: Number(citationStatsResult[0]?.itemsWithCitations || 0),
			totalCitations: Number(citationStatsResult[0]?.totalCitations || 0),
			avgCitationsPerItem: Number(citationStatsResult[0]?.avgCitations || 0),
			maxCitations: Number(citationStatsResult[0]?.maxCitations || 0),
			citationPercentage: totalItems > 0 ? Number(((Number(citationStatsResult[0]?.itemsWithCitations || 0) / totalItems) * 100).toFixed(2)) : 0,
			hIndex: globalHIndex
		};

		// Get creator statistics
		console.log("👥 Query 9/15: Calculating creator statistics...");
		const startTime9 = Date.now();
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
		console.log(`✅ Query 9 completed in ${Date.now() - startTime9}ms`);

		// Calculate global unique authors count first (needed for creatorStats)
		console.log("🔢 Query 10/15: Counting unique authors globally...");
		const startTime10 = Date.now();
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
		console.log(`✅ Query 10 completed in ${Date.now() - startTime10}ms (${creatorStats.uniqueCreators.toLocaleString()} unique authors)`);

		// Get field completeness
		console.log("📝 Query 11/15: Analyzing field completeness...");
		const startTime11 = Date.now();
		const fieldCompletenessResult = await db
			.select({
				titleFilled: sql<number>`count(case when ${item.title} is not null and ${item.title} != '' then 1 end)`,
				abstractFilled: sql<number>`count(case when ${item.abstractNote} is not null and ${item.abstractNote} != '' then 1 end)`,
				doiFilled: sql<number>`count(case when ${item.DOI} is not null and ${item.DOI} != '' then 1 end)`,
				urlFilled: sql<number>`count(case when ${item.url} is not null and ${item.url} != '' then 1 end)`,
				dateFilled: sql<number>`count(case when ${item.date} is not null and ${item.date} != '' then 1 end)`,
				institutionFilled: sql<number>`count(case when ${item.institution} is not null and ${item.institution} != '' then 1 end)`,
				creatorsFilled: sql<number>`count(case when ${item.creators} is not null then 1 end)`,
				pagesFilled: sql<number>`count(case when ${item.pages} is not null and ${item.pages} != '' then 1 end)`,
				volumeFilled: sql<number>`count(case when ${item.volume} is not null and ${item.volume} != '' then 1 end)`,
				issueFilled: sql<number>`count(case when ${item.issue} is not null and ${item.issue} != '' then 1 end)`,
				collectionsFilled: sql<number>`count(case when ${item.collections} is not null and array_length(${item.collections}, 1) > 0 then 1 end)`,
				languageFilled: sql<number>`count(case when ${item.languageName} is not null and ${item.languageName} != '' then 1 end)`
			})
			.from(item)
			.where(
				and(
					eq(item.deleted, 0),
					sql`${item.parentItem} IS NULL OR ${item.parentItem} = ''`
				)
			);

		const fieldStats = fieldCompletenessResult[0];
		const fieldCompleteness = [
			{ field: 'title', filledCount: Number(fieldStats?.titleFilled || 0), percentage: Number(((Number(fieldStats?.titleFilled || 0) / totalItems) * 100).toFixed(2)) },
			{ field: 'abstractNote', filledCount: Number(fieldStats?.abstractFilled || 0), percentage: Number(((Number(fieldStats?.abstractFilled || 0) / totalItems) * 100).toFixed(2)) },
			{ field: 'DOI', filledCount: Number(fieldStats?.doiFilled || 0), percentage: Number(((Number(fieldStats?.doiFilled || 0) / totalItems) * 100).toFixed(2)) },
			{ field: 'url', filledCount: Number(fieldStats?.urlFilled || 0), percentage: Number(((Number(fieldStats?.urlFilled || 0) / totalItems) * 100).toFixed(2)) },
			{ field: 'date', filledCount: Number(fieldStats?.dateFilled || 0), percentage: Number(((Number(fieldStats?.dateFilled || 0) / totalItems) * 100).toFixed(2)) },
			{ field: 'institution', filledCount: Number(fieldStats?.institutionFilled || 0), percentage: Number(((Number(fieldStats?.institutionFilled || 0) / totalItems) * 100).toFixed(2)) },
			{ field: 'creators', filledCount: Number(fieldStats?.creatorsFilled || 0), percentage: Number(((Number(fieldStats?.creatorsFilled || 0) / totalItems) * 100).toFixed(2)) },
			{ field: 'pages', filledCount: Number(fieldStats?.pagesFilled || 0), percentage: Number(((Number(fieldStats?.pagesFilled || 0) / totalItems) * 100).toFixed(2)) },
			{ field: 'volume', filledCount: Number(fieldStats?.volumeFilled || 0), percentage: Number(((Number(fieldStats?.volumeFilled || 0) / totalItems) * 100).toFixed(2)) },
			{ field: 'issue', filledCount: Number(fieldStats?.issueFilled || 0), percentage: Number(((Number(fieldStats?.issueFilled || 0) / totalItems) * 100).toFixed(2)) },
			{ field: 'collections', filledCount: Number(fieldStats?.collectionsFilled || 0), percentage: Number(((Number(fieldStats?.collectionsFilled || 0) / totalItems) * 100).toFixed(2)) },
			{ field: 'languageName', filledCount: Number(fieldStats?.languageFilled || 0), percentage: Number(((Number(fieldStats?.languageFilled || 0) / totalItems) * 100).toFixed(2)) }
		];
		console.log(`✅ Query 11 completed in ${Date.now() - startTime11}ms (${fieldCompleteness.length} fields analyzed)`);

		// Get attachment statistics
		console.log("📎 Query 12/15: Calculating attachment statistics...");
		const startTime12 = Date.now();
		const attachmentStatsResult = await db
			.select({
				totalAttachments: sql<number>`count(case when ${item.parentItem} is not null and ${item.parentItem} != '' then 1 end)`,
				itemsWithAttachments: sql<number>`count(distinct case when ${item.parentItem} is not null and ${item.parentItem} != '' then ${item.parentItem} end)`
			})
			.from(item)
			.where(eq(item.deleted, 0));

		const attachmentStats = {
			totalAttachments: Number(attachmentStatsResult[0]?.totalAttachments || 0),
			itemsWithAttachments: Number(attachmentStatsResult[0]?.itemsWithAttachments || 0),
			attachmentPercentage: totalItems > 0 ? Number(((Number(attachmentStatsResult[0]?.itemsWithAttachments || 0) / totalItems) * 100).toFixed(2)) : 0
		};
		console.log(`✅ Query 12 completed in ${Date.now() - startTime12}ms (${attachmentStats.totalAttachments.toLocaleString()} attachments)`);

		// Get top publishers
		console.log("📚 Query 13/15: Fetching publishers and journals...");
		const startTime13 = Date.now();
		const topPublishersResult = await db
			.select({
				publisher: item.publisher,
				count: sql<number>`count(*)`
			})
			.from(item)
			.where(
				and(
					eq(item.deleted, 0),
					isNotNull(item.publisher),
					ne(item.publisher, ''),
					sql`${item.parentItem} IS NULL OR ${item.parentItem} = ''`
				)
			)
			.groupBy(item.publisher)
			.orderBy(desc(sql`count(*)`))
			.limit(15);

		// Get top journals
		const topJournalsResult = await db
			.select({
				journal: item.publicationTitle,
				count: sql<number>`count(*)`
			})
			.from(item)
			.where(
				and(
					eq(item.deleted, 0),
					isNotNull(item.publicationTitle),
					ne(item.publicationTitle, ''),
					sql`${item.parentItem} IS NULL OR ${item.parentItem} = ''`
				)
			)
			.groupBy(item.publicationTitle)
			.orderBy(desc(sql`count(*)`))
			.limit(15);

		// Get language distribution
		const languageDistributionResult = await db
			.select({
				language: item.languageName,
				count: sql<number>`count(*)`
			})
			.from(item)
			.where(
				and(
					eq(item.deleted, 0),
					isNotNull(item.languageName),
					ne(item.languageName, ''),
					sql`${item.parentItem} IS NULL OR ${item.parentItem} = ''`
				)
			)
			.groupBy(item.languageName)
			.orderBy(desc(sql`count(*)`))
			.limit(10);
		console.log(`✅ Query 13 completed in ${Date.now() - startTime13}ms (${topPublishersResult.length} publishers, ${topJournalsResult.length} journals, ${languageDistributionResult.length} languages)`);

		// Get recent activity (items created in last 30 days by day)
		console.log("⏰ Query 14/15: Analyzing recent activity...");
		const startTime14 = Date.now();
		const recentActivityResult = await db
			.select({
				date: sql<string>`date(${item.createdAt})::text`,
				count: sql<number>`count(*)`
			})
			.from(item)
			.where(
				and(
					eq(item.deleted, 0),
					gte(item.createdAt, sql`now() - interval '30 days'`),
					sql`${item.parentItem} IS NULL OR ${item.parentItem} = ''`
				)
			)
			.groupBy(sql`date(${item.createdAt})`)
			.orderBy(desc(sql`date(${item.createdAt})`));
		console.log(`✅ Query 14 completed in ${Date.now() - startTime14}ms (${recentActivityResult.length} days of recent activity)`);

		// Get author countries statistics with citation data for H-Index (fixed to avoid distinct on citations)
		console.log("🌍 Query 15/15: Calculating comprehensive author and collaboration statistics...");
		const startTime15 = Date.now();
		const authorCountriesResult = await db
			.select({
				countryCode: sql<string>`country_code`,
				authorCount: sql<number>`count(distinct author_name)`,
				itemCount: sql<number>`count(distinct item_key)`,
				citationCounts: sql<number[]>`array_agg(
					case 
						when item_relations::jsonb ? 'cited_by' 
						then (item_relations::jsonb->>'cited_by')::int 
						else 0 
					end
				)`
			})
			.from(sql`(
				SELECT DISTINCT
					institution_data->>'country_code' as country_code,
					coalesce(
						nullif(trim(
							coalesce(creator_data->>'firstName', '') || 
							case when creator_data->>'firstName' is not null and creator_data->>'lastName' is not null then ' ' else '' end ||
							coalesce(creator_data->>'lastName', '')
						), ''),
						nullif(trim(creator_data->>'name'), ''),
						'Unknown Author'
					) as author_name,
					${item.key} as item_key,
					${item.relations} as item_relations
				FROM ${item},
				LATERAL unnest(${item.creators}) as creator_data,
				LATERAL jsonb_array_elements(creator_data->'institutions') as institution_data
				WHERE ${item.deleted} = 0 
				AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
				AND ${item.creators} IS NOT NULL
				AND array_length(${item.creators}, 1) > 0
				AND creator_data ? 'institutions'
				AND jsonb_typeof(creator_data->'institutions') = 'array'
				AND jsonb_array_length(creator_data->'institutions') > 0
				AND institution_data ? 'country_code'
				AND institution_data->>'country_code' IS NOT NULL
				AND institution_data->>'country_code' != ''
			) as country_author_items`)
			.where(sql`country_code IS NOT NULL AND country_code != '' AND author_name IS NOT NULL AND author_name != '' AND author_name != 'Unknown Author'`)
			.groupBy(sql`country_code`)
			.orderBy(desc(sql`count(distinct item_key)`))
			.limit(50);

		const authorCountries = authorCountriesResult.map(stat => ({
			countryCode: stat.countryCode || '',
			countryName: COUNTRIES[stat.countryCode as keyof typeof COUNTRIES] || stat.countryCode || '',
			authorCount: Number(stat.authorCount),
			itemCount: Number(stat.itemCount),
			hIndex: calculateHIndex(stat.citationCounts?.map(c => Number(c)) || [])
		}));
		console.log(`📊 Author countries processed (${authorCountries.length} countries)`);

		// Calculate International Collaboration Statistics
		console.log("🤝 Calculating collaboration statistics...");
		// First, get all items with their associated countries
		const itemsWithCountriesResult = await db
			.select({
				itemKey: sql<string>`item_key`,
				countries: sql<string[]>`array_agg(distinct country_code)`
			})
			.from(sql`(
				SELECT DISTINCT
					${item.key} as item_key,
					institution_data->>'country_code' as country_code
				FROM ${item},
				LATERAL unnest(${item.creators}) as creator_data,
				LATERAL jsonb_array_elements(creator_data->'institutions') as institution_data
				WHERE ${item.deleted} = 0 
				AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
				AND ${item.creators} IS NOT NULL
				AND array_length(${item.creators}, 1) > 0
				AND creator_data ? 'institutions'
				AND jsonb_typeof(creator_data->'institutions') = 'array'
				AND jsonb_array_length(creator_data->'institutions') > 0
				AND institution_data ? 'country_code'
				AND institution_data->>'country_code' IS NOT NULL
				AND institution_data->>'country_code' != ''
			) as item_countries`)
			.where(sql`country_code IS NOT NULL AND country_code != ''`)
			.groupBy(sql`item_key`);

		// Identify the base country (top country by items)
		const baseCountry = authorCountries[0];
		const baseCountryCode = baseCountry?.countryCode || '';

		// Calculate overall collaboration metrics
		const totalItemsWithCountries = itemsWithCountriesResult.length;
		const collaborativeItems = itemsWithCountriesResult.filter(item => item.countries.length > 1);
		const collaborativeItemsCount = collaborativeItems.length;
		const overallCollaborationRate = totalItemsWithCountries > 0 ? (collaborativeItemsCount / totalItemsWithCountries) * 100 : 0;

		// Calculate base country collaboration metrics
		const baseCountryItems = itemsWithCountriesResult.filter(item => item.countries.includes(baseCountryCode));
		const baseCountryCollaborativeItems = baseCountryItems.filter(item => item.countries.length > 1);
		const baseCountryCollaborationRate = baseCountryItems.length > 0 ? (baseCountryCollaborativeItems.length / baseCountryItems.length) * 100 : 0;

		// Calculate country collaboration rates - three distinct metrics
		const countryCollaborationRates = authorCountries.slice(0, 21).map(country => { // Top 21 countries including base
			const countryItems = itemsWithCountriesResult.filter(item => item.countries.includes(country.countryCode));
			
			// 1. International: all international collaborations (including with base country)
			const internationalItems = countryItems.filter(item => item.countries.length > 1);
			const internationalRate = countryItems.length > 0 ? (internationalItems.length / countryItems.length) * 100 : 0;
			
			// 2. Independent: international collaborations excluding base country
			const independentItems = countryItems.filter(item => 
				item.countries.length > 1 && !item.countries.includes(baseCountryCode)
			);
			const independentRate = countryItems.length > 0 ? (independentItems.length / countryItems.length) * 100 : 0;
			
			// 3. Domestic: no international collaboration (single country only)
			const domesticItems = countryItems.filter(item => item.countries.length === 1);
			const domesticRate = countryItems.length > 0 ? (domesticItems.length / countryItems.length) * 100 : 0;

			return {
				countryCode: country.countryCode,
				countryName: country.countryName,
				totalItems: countryItems.length,
				internationalItems: internationalItems.length,
				internationalRate: Number(internationalRate.toFixed(2)),
				independentItems: independentItems.length,
				independentRate: Number(independentRate.toFixed(2)),
				domesticItems: domesticItems.length,
				domesticRate: Number(domesticRate.toFixed(2))
			};
		});

		// Calculate top collaborations between countries (including base country collaborations)
		const collaborationPairs = new Map<string, number>();
		collaborativeItems.forEach(item => {
			const countries = item.countries.sort();
			for (let i = 0; i < countries.length; i++) {
				for (let j = i + 1; j < countries.length; j++) {
					const country1 = countries[i];
					const country2 = countries[j];
					
					const pairKey = `${country1}-${country2}`;
					collaborationPairs.set(pairKey, (collaborationPairs.get(pairKey) || 0) + 1);
				}
			}
		});

		const topCollaborations = Array.from(collaborationPairs.entries())
			.map(([pair, count]) => {
				const [country1, country2] = pair.split('-');
				return {
					country1,
					country2,
					country1Name: COUNTRIES[country1 as keyof typeof COUNTRIES] || country1,
					country2Name: COUNTRIES[country2 as keyof typeof COUNTRIES] || country2,
					collaborationCount: count
				};
			})
			.sort((a, b) => b.collaborationCount - a.collaborationCount)
			.slice(0, 15);

		// Create collaboration matrix for network visualization
		const collaborationMatrix: { [key: string]: { [key: string]: number } } = {};
		const topCountries = authorCountries.slice(0, 15).map(c => c.countryCode);
		
		// Initialize matrix
		topCountries.forEach(country1 => {
			collaborationMatrix[country1] = {};
			topCountries.forEach(country2 => {
				collaborationMatrix[country1][country2] = 0;
			});
		});

		// Fill matrix with collaboration counts
		collaborativeItems.forEach(item => {
			const countries = item.countries.filter(c => topCountries.includes(c));
			for (let i = 0; i < countries.length; i++) {
				for (let j = i + 1; j < countries.length; j++) {
					const country1 = countries[i];
					const country2 = countries[j];
					collaborationMatrix[country1][country2]++;
					collaborationMatrix[country2][country1]++;
				}
			}
		});

		const collaborationStats: CollaborationStats = {
			totalItems: totalItemsWithCountries,
			collaborativeItems: collaborativeItemsCount,
			overallCollaborationRate: Number(overallCollaborationRate.toFixed(2)),
			baseCountry: {
				countryCode: baseCountryCode,
				countryName: baseCountry?.countryName || '',
				totalItems: baseCountryItems.length,
				collaborativeItems: baseCountryCollaborativeItems.length,
				collaborationRate: Number(baseCountryCollaborationRate.toFixed(2))
			},
			countryCollaborationRates,
			topCollaborations,
			collaborationMatrix
		};
		console.log(`✅ Collaboration statistics calculated (${collaborationStats.totalItems.toLocaleString()} items, ${collaborationStats.overallCollaborationRate}% collaboration rate)`);

		// Calculate TRUE global author productivity stats (ALL authors)
		console.log("👨‍🎓 Calculating REAL global author productivity stats...");
		const globalAuthorProductivityResult = await db
			.select({
				totalAuthors: sql<number>`count(distinct author_name)`,
				authorsWithMultiple: sql<number>`count(distinct case when item_count > 1 then author_name end)`,
				avgItemsPerAuthor: sql<number>`avg(item_count)`,
				maxItemsPerAuthor: sql<number>`max(item_count)`,
				singleAuthorCount: sql<number>`count(distinct case when item_count = 1 then author_name end)`,
				twoToFiveCount: sql<number>`count(distinct case when item_count between 2 and 5 then author_name end)`,
				sixToTenCount: sql<number>`count(distinct case when item_count between 6 and 10 then author_name end)`,
				elevenToTwentyCount: sql<number>`count(distinct case when item_count between 11 and 20 then author_name end)`,
				twentyOneToFiftyCount: sql<number>`count(distinct case when item_count between 21 and 50 then author_name end)`,
				fiftyPlusCount: sql<number>`count(distinct case when item_count > 50 then author_name end)`
			})
			.from(sql`(
				SELECT 
					coalesce(
						nullif(trim(
							coalesce(creator_data->>'firstName', '') || 
							case when creator_data->>'firstName' is not null and creator_data->>'lastName' is not null then ' ' else '' end ||
							coalesce(creator_data->>'lastName', '')
						), ''),
						nullif(trim(creator_data->>'name'), ''),
						'Unknown Author'
					) as author_name,
					count(distinct ${item.key}) as item_count
				FROM ${item},
				LATERAL unnest(${item.creators}) as creator_data
				WHERE ${item.deleted} = 0 
				AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
				AND ${item.creators} IS NOT NULL
				AND array_length(${item.creators}, 1) > 0
				GROUP BY author_name
			) as author_productivity`)
			.where(sql`author_name IS NOT NULL AND author_name != '' AND author_name != 'Unknown Author'`);

		// Calculate TRUE global collaboration rate (ALL authors)
		console.log("🤝 Calculating REAL global collaboration rate...");
		const globalCollaborationResult = await db
			.select({
				soloAuthors: sql<number>`count(distinct case when max_collaborators = 0 then author_name end)`,
				collaborativeAuthors: sql<number>`count(distinct case when max_collaborators > 0 then author_name end)`,
				avgCollaborators: sql<number>`avg(max_collaborators)`,
				maxCollaborators: sql<number>`max(max_collaborators)`
			})
			.from(sql`(
				SELECT 
					coalesce(
						nullif(trim(
							coalesce(creator_data->>'firstName', '') || 
							case when creator_data->>'firstName' is not null and creator_data->>'lastName' is not null then ' ' else '' end ||
							coalesce(creator_data->>'lastName', '')
						), ''),
						nullif(trim(creator_data->>'name'), ''),
						'Unknown Author'
					) as author_name,
					max(array_length(${item.creators}, 1) - 1) as max_collaborators
				FROM ${item},
				LATERAL unnest(${item.creators}) as creator_data
				WHERE ${item.deleted} = 0 
				AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
				AND ${item.creators} IS NOT NULL
				AND array_length(${item.creators}, 1) > 0
				GROUP BY author_name
			) as author_collaboration`)
			.where(sql`author_name IS NOT NULL AND author_name != '' AND author_name != 'Unknown Author'`);

		// Calculate simplified detailed author statistics for top authors (for the table display)  
		console.log("📊 Calculating detailed author statistics (top 200)...");
		const detailedAuthorStatsResult = await db
			.select({
				authorName: sql<string>`author_name`,
				firstName: sql<string>`first_name`,
				lastName: sql<string>`last_name`,
				itemCount: sql<number>`count(distinct item_key)`,
				totalCitations: sql<number>`coalesce(sum(
					case 
						when item_relations::jsonb ? 'cited_by' 
						then (item_relations::jsonb->>'cited_by')::int 
						else 0 
					end
				), 0)`,
				citationCounts: sql<number[]>`array_agg(
					case 
						when item_relations::jsonb ? 'cited_by' 
						then (item_relations::jsonb->>'cited_by')::int 
						else 0 
					end
				)`,
				countryCount: sql<number>`count(distinct country_code)`,
				institutionCount: sql<number>`count(distinct institution_name)`,
				creatorTypes: sql<string[]>`array_agg(distinct creator_type)`,
				countries: sql<string[]>`array_agg(distinct country_code)`,
				institutions: sql<string[]>`array_agg(distinct institution_name)`,
				firstPublicationYear: sql<number>`min(extract(year from 
					case 
						when item_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' 
						then to_date(item_date, 'YYYY-MM-DD')
						else null
					end
				))`,
				lastPublicationYear: sql<number>`max(extract(year from 
					case 
						when item_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' 
						then to_date(item_date, 'YYYY-MM-DD')
						else null
					end
				))`,
				mostRecentYear: sql<number>`max(extract(year from 
					case 
						when item_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' 
						then to_date(item_date, 'YYYY-MM-DD')
						else null
					end
				))`
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
					) as author_name,
					creator_data->>'firstName' as first_name,
					creator_data->>'lastName' as last_name,
					creator_data->>'creatorType' as creator_type,
					${item.key} as item_key,
					${item.relations} as item_relations,
					${item.date} as item_date,
					institution_data->>'display_name' as institution_name,
					institution_data->>'country_code' as country_code
				FROM ${item},
				LATERAL unnest(${item.creators}) as creator_data,
				LATERAL jsonb_array_elements(
					case 
						when creator_data ? 'institutions' and jsonb_typeof(creator_data->'institutions') = 'array' 
						then creator_data->'institutions'
						else '[{}]'::jsonb
					end
				) as institution_data
				WHERE ${item.deleted} = 0 
				AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
				AND ${item.creators} IS NOT NULL
				AND array_length(${item.creators}, 1) > 0
				AND trim(coalesce(creator_data->>'firstName', '') || ' ' || coalesce(creator_data->>'lastName', '') || ' ' || coalesce(creator_data->>'name', '')) != ''
			) as author_details`)
			.where(sql`author_name IS NOT NULL AND author_name != '' AND author_name != 'Unknown Author'`)
			.groupBy(sql`author_name, first_name, last_name`)
			.having(sql`count(distinct item_key) >= 2`) // Only prolific authors
			.orderBy(desc(sql`count(distinct item_key)`))
			.limit(200); // Reduced to top 200 most productive authors

		const authorStats = detailedAuthorStatsResult.map(stat => {
			const hIndex = calculateHIndex(stat.citationCounts?.map(c => Number(c)) || []);
			const yearSpan = stat.lastPublicationYear > stat.firstPublicationYear 
				? stat.lastPublicationYear - stat.firstPublicationYear + 1 
				: 1;
			
			// Determine most common creator type
			const creatorTypeCounts = stat.creatorTypes.reduce((acc, type) => {
				acc[type] = (acc[type] || 0) + 1;
				return acc;
			}, {} as Record<string, number>);
			const mostCommonCreatorType = Object.entries(creatorTypeCounts)
				.sort(([,a], [,b]) => b - a)[0]?.[0] || 'author';

			return {
				authorName: stat.authorName?.trim() || '',
				firstName: stat.firstName || '',
				lastName: stat.lastName || '',
				displayName: stat.firstName && stat.lastName 
					? `${stat.firstName} ${stat.lastName}`.trim()
					: stat.authorName?.trim() || '',
				itemCount: Number(stat.itemCount),
				totalCitations: Number(stat.totalCitations),
				avgCitationsPerItem: Number(stat.itemCount) > 0 
					? Number((Number(stat.totalCitations) / Number(stat.itemCount)).toFixed(2))
					: 0,
				hIndex,
				countryCount: Number(stat.countryCount),
				institutionCount: Number(stat.institutionCount),
				creatorTypes: stat.creatorTypes.filter(type => type && type.trim() !== ''),
				mostCommonCreatorType,
				countries: stat.countries.filter(country => country && country.trim() !== ''),
				institutions: stat.institutions.filter(inst => inst && inst.trim() !== ''),
				firstPublicationYear: Number(stat.firstPublicationYear) || new Date().getFullYear(),
				lastPublicationYear: Number(stat.lastPublicationYear) || new Date().getFullYear(),
				yearSpan,
				mostRecentYear: Number(stat.mostRecentYear) || new Date().getFullYear()
			};
		});

		// Calculate author productivity distribution using global data


		// Extract REAL global statistics from our comprehensive queries
		const globalProductivity = globalAuthorProductivityResult[0];
		const globalCollaboration = globalCollaborationResult[0];

		// Build REAL productivity distribution from actual counts
		const productivityDistribution = [
			{ range: '1 item', count: Number(globalProductivity?.singleAuthorCount || 0), percentage: Number(((Number(globalProductivity?.singleAuthorCount || 0) / Number(globalProductivity?.totalAuthors || 1)) * 100).toFixed(1)) },
			{ range: '2-5 items', count: Number(globalProductivity?.twoToFiveCount || 0), percentage: Number(((Number(globalProductivity?.twoToFiveCount || 0) / Number(globalProductivity?.totalAuthors || 1)) * 100).toFixed(1)) },
			{ range: '6-10 items', count: Number(globalProductivity?.sixToTenCount || 0), percentage: Number(((Number(globalProductivity?.sixToTenCount || 0) / Number(globalProductivity?.totalAuthors || 1)) * 100).toFixed(1)) },
			{ range: '11-20 items', count: Number(globalProductivity?.elevenToTwentyCount || 0), percentage: Number(((Number(globalProductivity?.elevenToTwentyCount || 0) / Number(globalProductivity?.totalAuthors || 1)) * 100).toFixed(1)) },
			{ range: '21-50 items', count: Number(globalProductivity?.twentyOneToFiftyCount || 0), percentage: Number(((Number(globalProductivity?.twentyOneToFiftyCount || 0) / Number(globalProductivity?.totalAuthors || 1)) * 100).toFixed(1)) },
			{ range: '50+ items', count: Number(globalProductivity?.fiftyPlusCount || 0), percentage: Number(((Number(globalProductivity?.fiftyPlusCount || 0) / Number(globalProductivity?.totalAuthors || 1)) * 100).toFixed(1)) }
		];

		const authorProductivityStats: AuthorProductivityStats = {
			totalAuthors: Number(globalProductivity?.totalAuthors || 0),
			authorsWithMultipleWorks: Number(globalProductivity?.authorsWithMultiple || 0),
			avgItemsPerAuthor: Number((Number(globalProductivity?.avgItemsPerAuthor || 0)).toFixed(2)),
			maxItemsPerAuthor: Number(globalProductivity?.maxItemsPerAuthor || 0),
			productivityDistribution
		};

		// Build REAL collaboration statistics
		const totalAuthorsForCollab = Number(globalCollaboration?.soloAuthors || 0) + Number(globalCollaboration?.collaborativeAuthors || 0);
		const collaborationRate = totalAuthorsForCollab > 0 ? (Number(globalCollaboration?.collaborativeAuthors || 0) / totalAuthorsForCollab) * 100 : 0;

		const authorCollaborationStats: AuthorCollaborationStats = {
			soloAuthors: Number(globalCollaboration?.soloAuthors || 0),
			collaborativeAuthors: Number(globalCollaboration?.collaborativeAuthors || 0),
			avgCollaboratorsPerAuthor: Number((Number(globalCollaboration?.avgCollaborators || 0)).toFixed(2)),
			maxCollaboratorsPerAuthor: Number(globalCollaboration?.maxCollaborators || 0),
			collaborationRate: Number(collaborationRate.toFixed(2))
		};
		
		const endTime15 = Date.now();
		console.log(`✅ Query 15 completed in ${endTime15 - startTime15}ms`);

		// Get topic/collection statistics with hierarchical analysis
		console.log("📚 Query 16/16: Analyzing topic/collection statistics...");
		const startTime16 = Date.now();
		const topicStatsResult = await db
			.select({
				collections: item.collections,
				itemKey: item.key,
				citationCount: sql<number>`case 
					when ${item.relations}::jsonb ? 'cited_by' 
					then (${item.relations}::jsonb->>'cited_by')::int 
					else 0 
				end`
			})
			.from(item)
			.where(
				and(
					eq(item.deleted, 0),
					sql`${item.parentItem} IS NULL OR ${item.parentItem} = ''`,
					isNotNull(item.collections),
					sql`array_length(${item.collections}, 1) > 0`
				)
			);

		// Process hierarchical topic structure
		const topicMap = new Map<string, {
			fullPath: string;
			level: number;
			parentTopic?: string;
			itemKeys: Set<string>;
			citationCounts: number[];
			children: Set<string>;
		}>();

		// Extract all topics and their hierarchy
		topicStatsResult.forEach((row) => {
			if (!row.collections || row.collections.length === 0) return;
			
			row.collections.forEach((collection: string) => {
				if (!collection || collection.trim() === '') return;
				
				const parts = collection.split('/').map(part => part.trim()).filter(part => part !== '');
				
				// Build hierarchical paths
				for (let i = 0; i < parts.length; i++) {
					const currentPath = parts.slice(0, i + 1).join('/');
					const currentTopic = parts[i];
					const parentPath = i > 0 ? parts.slice(0, i).join('/') : undefined;
					
					if (!topicMap.has(currentPath)) {
						topicMap.set(currentPath, {
							fullPath: currentPath,
							level: i + 1,
							parentTopic: parentPath,
							itemKeys: new Set(),
							citationCounts: [],
							children: new Set()
						});
					}
					
					const topicData = topicMap.get(currentPath)!;
					topicData.itemKeys.add(row.itemKey);
					topicData.citationCounts.push(row.citationCount || 0);
					
					// Add child relationship
					if (parentPath && topicMap.has(parentPath)) {
						topicMap.get(parentPath)!.children.add(currentPath);
					}
				}
			});
		});

		// Calculate statistics for each topic
		const topicStats: TopicStats[] = Array.from(topicMap.entries()).map(([path, data]) => {
			const uniqueItemKeys = Array.from(data.itemKeys);
			const uniqueCitationCounts = data.citationCounts; // Already filtered to unique items per topic
			const totalCitations = uniqueCitationCounts.reduce((sum, count) => sum + count, 0);
			const avgCitations = uniqueItemKeys.length > 0 ? totalCitations / uniqueItemKeys.length : 0;
			const hIndex = calculateHIndex(uniqueCitationCounts);
			
			const topicName = path.split('/').pop() || path;
			
			return {
				topic: topicName,
				level: data.level,
				parentTopic: data.parentTopic ? data.parentTopic.split('/').pop() : undefined,
				fullPath: path,
				itemCount: uniqueItemKeys.length,
				totalCitations,
				avgCitationsPerItem: Number(avgCitations.toFixed(2)),
				hIndex,
				isLeaf: data.children.size === 0,
				children: Array.from(data.children).map(childPath => childPath.split('/').pop() || childPath)
			};
		}).sort((a, b) => b.itemCount - a.itemCount);

		// Calculate topic overview statistics
		const maxDepth = Math.max(...Array.from(topicMap.values()).map(t => t.level));
		const topLevelTopics = Array.from(topicMap.values()).filter(t => t.level === 1).length;
		const totalUniqueItems = new Set();
		topicStatsResult.forEach(row => totalUniqueItems.add(row.itemKey));
		const avgItemsPerTopic = topicStats.length > 0 ? totalUniqueItems.size / topicStats.length : 0;

		// Calculate distribution by level
		const levelCounts = new Map<number, number>();
		for (let level = 1; level <= maxDepth; level++) {
			levelCounts.set(level, Array.from(topicMap.values()).filter(t => t.level === level).length);
		}

		const topicDistribution = Array.from(levelCounts.entries()).map(([level, count]) => ({
			level,
			count,
			percentage: Number(((count / topicStats.length) * 100).toFixed(1))
		}));

		const topicOverview: TopicOverview = {
			totalTopics: topicStats.length,
			maxDepth,
			topLevelTopics,
			avgItemsPerTopic: Number(avgItemsPerTopic.toFixed(1)),
			topicDistribution
		};

		const endTime16 = Date.now();
		console.log(`✅ Query 16 completed in ${endTime16 - startTime16}ms (${topicStats.length} topics, max depth: ${maxDepth})`);
		console.log(`🎉 All statistics calculated! Total time: ${endTime16 - startTime1}ms`);
		console.log(`📈 Final stats: ${authorStats.length} detailed authors, ${authorProductivityStats.totalAuthors.toLocaleString()} total authors, ${authorCollaborationStats.collaborationRate}% collaboration rate, ${topicStats.length} topics`);

		const comprehensiveStats: ComprehensiveStats = {
			institutions: institutionStatsResult.map(stat => ({
				institution: stat.institution?.trim() || '',
				countryCode: stat.countryCode || '',
				itemCount: Number(stat.itemCount),
				totalCitations: Number(stat.totalCitations),
				avgCitationsPerItem: Number(stat.avgCitationsPerItem),
				hIndex: calculateHIndex(stat.citationCounts?.map(c => Number(c)) || [])
			})),
			institutionsByYear: institutionsByYearResult.map(stat => ({
				institution: stat.institution?.trim() || '',
				countryCode: stat.countryCode || '',
				year: stat.year || '',
				itemCount: Number(stat.itemCount),
				totalCitations: Number(stat.totalCitations),
				avgCitationsPerItem: Number(stat.avgCitationsPerItem),
				hIndex: calculateHIndex(stat.citationCounts?.map(c => Number(c)) || [])
			})),
			availableYears: availableYearsResult.map(stat => stat.year || ''),
			itemTypes,
			yearDistribution: yearStatsResult.map(stat => ({
				year: stat.year || '',
				count: Number(stat.count)
			})),
			citationStats,
			creatorStats,
			fieldCompleteness,
			attachmentStats,
			authorCountries,
			collaborationStats,
			authorStats,
			authorProductivityStats,
			authorCollaborationStats,
			topPublishers: topPublishersResult.map(stat => ({
				publisher: stat.publisher || '',
				count: Number(stat.count)
			})),
			topJournals: topJournalsResult.map(stat => ({
				journal: stat.journal || '',
				count: Number(stat.count)
			})),
			languageDistribution: languageDistributionResult.map(stat => ({
				language: stat.language || '',
				count: Number(stat.count)
			})),
			recentActivity: recentActivityResult.map(stat => ({
				date: stat.date || '',
				count: Number(stat.count)
			})),
			topicStats,
			topicOverview
		};

		console.log("💾 Caching statistics to Meilisearch...");
		const cacheStart = Date.now();
		await meilisearch.index(index).addDocuments([
			{
				id: documentId,
				content: JSON.stringify(comprehensiveStats),
			},
		]);
		console.log(`✅ Statistics cached in ${Date.now() - cacheStart}ms`);
		return comprehensiveStats;
	}
}

export default async function Statistics() {
	const status = await getCachedStatus();

	const links = status.links || [];
	const hasStatistics = links.some(link => link.href.includes("statistics"));

	if (!hasStatistics) {
		return notFound();
	}

	const stats = await getComprehensiveStats(false);
	
	return <StatisticsPage stats={stats} />;
}
