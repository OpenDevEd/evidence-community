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

type InstitutionStats = {
	institution: string;
	countryCode: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
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
};

type ComprehensiveStats = {
	institutions: InstitutionStats[];
	itemTypes: ItemTypeStats[];
	yearDistribution: YearStats[];
	citationStats: CitationStats;
	creatorStats: CreatorStats;
	fieldCompleteness: FieldStats[];
	attachmentStats: AttachmentStats;
	authorCountries: AuthorCountryStats[];
	topPublishers: { publisher: string; count: number }[];
	topJournals: { journal: string; count: number }[];
	languageDistribution: { language: string; count: number }[];
	recentActivity: { date: string; count: number }[];
};

async function getComprehensiveStats(ignore: boolean): Promise<ComprehensiveStats> {
	const index = "cache";
	const documentId = process.env.MEILI_INDEX + "-comprehensive-stats";

	try {
		if (ignore) {
			throw new Error("Ignore");
		}
		const statsResult = await meilisearch
			.index(index)
			.getDocument(documentId);
		return JSON.parse(statsResult.content);
	} catch (error) {
		const indexCreation = await meilisearch.createIndex(index);
		await meilisearch.waitForTask(indexCreation.taskUid);

		// Get institution stats
		const institutionStatsResult = await db
			.select({
				institution: sql<string>`institution_data->>'display_name'`,
				countryCode: sql<string>`institution_data->>'country_code'`,
				itemCount: sql<number>`count(distinct item_key)`,
				totalCitations: sql<number>`coalesce(sum(
					case 
						when item_relations::jsonb ? 'cited_by' 
						then (item_relations::jsonb->>'cited_by')::int 
						else 0 
					end
				), 0)`,
				avgCitationsPerItem: sql<number>`coalesce(avg(
					case 
						when item_relations::jsonb ? 'cited_by' 
						then (item_relations::jsonb->>'cited_by')::int 
						else 0 
					end
				), 0)`,
			})
			.from(sql`(
				SELECT 
					${item.key} as item_key,
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
			) as institution_stats`)
			.where(sql`institution_data->>'display_name' IS NOT NULL AND institution_data->>'display_name' != ''`)
			.groupBy(sql`institution_data->>'display_name', institution_data->>'country_code'`)
			.orderBy(desc(sql`count(distinct item_key)`));

		// Get total items count (excluding attachments)
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

		// Get item type distribution
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

		// Get year distribution
		const yearStatsResult = await db
			.select({
				year: sql<string>`extract(year from to_date(${item.date}, 'YYYY-MM-DD'))::text`,
				count: sql<number>`count(*)`
			})
			.from(item)
			.where(
				and(
					eq(item.deleted, 0),
					isNotNull(item.date),
					ne(item.date, ''),
					sql`${item.parentItem} IS NULL OR ${item.parentItem} = ''`
				)
			)
			.groupBy(sql`extract(year from to_date(${item.date}, 'YYYY-MM-DD'))`)
			.orderBy(desc(sql`extract(year from to_date(${item.date}, 'YYYY-MM-DD'))`))
			.limit(20);

		// Get citation statistics
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

		const citationStats = {
			totalItems: Number(citationStatsResult[0]?.totalItems || 0),
			itemsWithCitations: Number(citationStatsResult[0]?.itemsWithCitations || 0),
			totalCitations: Number(citationStatsResult[0]?.totalCitations || 0),
			avgCitationsPerItem: Number(citationStatsResult[0]?.avgCitations || 0),
			maxCitations: Number(citationStatsResult[0]?.maxCitations || 0),
			citationPercentage: totalItems > 0 ? Number(((Number(citationStatsResult[0]?.itemsWithCitations || 0) / totalItems) * 100).toFixed(2)) : 0
		};

		// Get creator statistics
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

		// Get global unique authors count
		const globalUniqueAuthorsResult = await db
			.select({
				uniqueAuthors: sql<number>`count(distinct author_name)`
			})
			.from(sql`(
				SELECT DISTINCT
					trim(coalesce(creator_data->>'firstName', '') || ' ' || coalesce(creator_data->>'lastName', '') || ' ' || coalesce(creator_data->>'name', '')) as author_name
				FROM ${item},
				LATERAL unnest(${item.creators}) as creator_data
				WHERE ${item.deleted} = 0 
				AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
				AND ${item.creators} IS NOT NULL
				AND array_length(${item.creators}, 1) > 0
				AND trim(coalesce(creator_data->>'firstName', '') || ' ' || coalesce(creator_data->>'lastName', '') || ' ' || coalesce(creator_data->>'name', '')) != ''
			) as all_authors`);

		const creatorStats = {
			totalCreators: Number(creatorStatsResult[0]?.totalCreators || 0),
			uniqueCreators: Number(globalUniqueAuthorsResult[0]?.uniqueAuthors || 0),
			avgCreatorsPerItem: Number(creatorStatsResult[0]?.avgCreators || 0),
			maxCreatorsPerItem: Number(creatorStatsResult[0]?.maxCreators || 0)
		};

		// Get field completeness
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
			{ field: 'collectionsData', filledCount: Number(fieldStats?.collectionsFilled || 0), percentage: Number(((Number(fieldStats?.collectionsFilled || 0) / totalItems) * 100).toFixed(2)) },
			{ field: 'languageName', filledCount: Number(fieldStats?.languageFilled || 0), percentage: Number(((Number(fieldStats?.languageFilled || 0) / totalItems) * 100).toFixed(2)) }
		];

		// Get attachment statistics
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

		// Get top publishers
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

		// Get recent activity (items created in last 30 days by day)
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

		// Get author countries statistics
		const authorCountriesResult = await db
			.select({
				countryCode: sql<string>`country_code`,
				authorCount: sql<number>`count(distinct author_name)`,
				itemCount: sql<number>`count(distinct item_key)`
			})
			.from(sql`(
				SELECT DISTINCT
					institution_data->>'country_code' as country_code,
					trim(coalesce(creator_data->>'firstName', '') || ' ' || coalesce(creator_data->>'lastName', '') || ' ' || coalesce(creator_data->>'name', '')) as author_name,
					${item.key} as item_key
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
				AND trim(coalesce(creator_data->>'firstName', '') || ' ' || coalesce(creator_data->>'lastName', '') || ' ' || coalesce(creator_data->>'name', '')) != ''
			) as country_author_items`)
			.where(sql`country_code IS NOT NULL AND country_code != ''`)
			.groupBy(sql`country_code`)
			.orderBy(desc(sql`count(distinct item_key)`))
			.limit(50);

		const authorCountries = authorCountriesResult.map(stat => ({
			countryCode: stat.countryCode || '',
			countryName: COUNTRIES[stat.countryCode as keyof typeof COUNTRIES] || stat.countryCode || '',
			authorCount: Number(stat.authorCount),
			itemCount: Number(stat.itemCount)
		}));

		const comprehensiveStats: ComprehensiveStats = {
			institutions: institutionStatsResult.map(stat => ({
				institution: stat.institution?.trim() || '',
				countryCode: stat.countryCode || '',
				itemCount: Number(stat.itemCount),
				totalCitations: Number(stat.totalCitations),
				avgCitationsPerItem: Number(stat.avgCitationsPerItem)
			})),
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
			}))
		};

		await meilisearch.index(index).addDocuments([
			{
				id: documentId,
				content: JSON.stringify(comprehensiveStats),
			},
		]);
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
