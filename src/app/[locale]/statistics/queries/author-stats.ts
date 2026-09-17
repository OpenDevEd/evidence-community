import type { Database } from "@/db";
import { item } from "@/db/schema/tables/item";
import { eq, and, sql, desc } from "drizzle-orm";
import { calculateHIndex } from "./utils";
import { COUNTRIES } from "@/constants/misc";
import { citationCountForItem, type CitationMeasure } from "./citation-measure";
import {
	affiliationCountryJoin,
	institutionCountryCode,
} from "./institution-country-sql";

export type AuthorCountryStats = {
	countryCode: string;
	countryName: string;
	authorCount: number;
	itemCount: number;
	hIndex: number;
};

export type AuthorStats = {
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

export type AuthorProductivityStats = {
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

export type AuthorCollaborationStats = {
	soloAuthors: number;
	collaborativeAuthors: number;
	avgCollaboratorsPerAuthor: number;
	maxCollaboratorsPerAuthor: number;
	collaborationRate: number;
};

export async function getAuthorCountries(
	db: Database,
	measure: CitationMeasure,
): Promise<AuthorCountryStats[]> {
	const citationCount = citationCountForItem(measure);
	const authorCountriesResult = await db
		.select({
			countryCode: sql<string>`country_code`,
			authorCount: sql<number>`count(distinct author_name)`,
			itemCount: sql<number>`count(distinct item_key)`,
			citationCounts: sql<number[]>`array_agg(item_citations)`,
		})
		.from(
			sql`(
			SELECT DISTINCT
				${institutionCountryCode} as country_code,
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
				${citationCount} as item_citations
			FROM ${item},
			LATERAL jsonb_array_elements(${item.creators}) as creator_data,
			LATERAL jsonb_array_elements(creator_data->'institutions') as institution_data
			${affiliationCountryJoin}
			WHERE ${item.deleted} = 0 
			AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
			AND ${item.creators} IS NOT NULL
			AND jsonb_array_length(${item.creators}) > 0
			AND creator_data ? 'institutions'
			AND jsonb_typeof(creator_data->'institutions') = 'array'
			AND jsonb_array_length(creator_data->'institutions') > 0
			AND ${institutionCountryCode} IS NOT NULL
		) as country_author_items`,
		)
		.where(
			sql`country_code IS NOT NULL AND country_code != '' AND author_name IS NOT NULL AND author_name != '' AND author_name != 'Unknown Author'`,
		)
		.groupBy(sql`country_code`)
		.orderBy(desc(sql`count(distinct item_key)`))
		.limit(50);

	const authorCountries = authorCountriesResult.map((stat) => ({
		countryCode: stat.countryCode || "",
		countryName:
			COUNTRIES[stat.countryCode as keyof typeof COUNTRIES] ||
			stat.countryCode ||
			"",
		authorCount: Number(stat.authorCount),
		itemCount: Number(stat.itemCount),
		hIndex: calculateHIndex(
			stat.citationCounts?.map((c) => Number(c)) || [],
		),
	}));
	
	return authorCountries;
}

export async function getAuthorProductivityStats(
	db: Database,
): Promise<AuthorProductivityStats> {
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
			fiftyPlusCount: sql<number>`count(distinct case when item_count > 50 then author_name end)`,
		})
		.from(
			sql`(
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
			LATERAL jsonb_array_elements(${item.creators}) as creator_data
			WHERE ${item.deleted} = 0 
			AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
			AND ${item.creators} IS NOT NULL
			AND jsonb_array_length(${item.creators}) > 0
			GROUP BY author_name
		) as author_productivity`,
		)
		.where(
			sql`author_name IS NOT NULL AND author_name != '' AND author_name != 'Unknown Author'`,
		);

	const globalProductivity = globalAuthorProductivityResult[0];
	
	// Build productivity distribution from actual counts
	const productivityDistribution = [
		{
			range: "1 item",
			count: Number(globalProductivity?.singleAuthorCount || 0),
			percentage: Number(
				(
					(Number(globalProductivity?.singleAuthorCount || 0) /
						Number(globalProductivity?.totalAuthors || 1)) *
					100
				).toFixed(1),
			),
		},
		{
			range: "2-5 items",
			count: Number(globalProductivity?.twoToFiveCount || 0),
			percentage: Number(
				(
					(Number(globalProductivity?.twoToFiveCount || 0) /
						Number(globalProductivity?.totalAuthors || 1)) *
					100
				).toFixed(1),
			),
		},
		{
			range: "6-10 items",
			count: Number(globalProductivity?.sixToTenCount || 0),
			percentage: Number(
				(
					(Number(globalProductivity?.sixToTenCount || 0) /
						Number(globalProductivity?.totalAuthors || 1)) *
					100
				).toFixed(1),
			),
		},
		{
			range: "11-20 items",
			count: Number(globalProductivity?.elevenToTwentyCount || 0),
			percentage: Number(
				(
					(Number(globalProductivity?.elevenToTwentyCount || 0) /
						Number(globalProductivity?.totalAuthors || 1)) *
					100
				).toFixed(1),
			),
		},
		{
			range: "21-50 items",
			count: Number(globalProductivity?.twentyOneToFiftyCount || 0),
			percentage: Number(
				(
					(Number(globalProductivity?.twentyOneToFiftyCount || 0) /
						Number(globalProductivity?.totalAuthors || 1)) *
					100
				).toFixed(1),
			),
		},
		{
			range: "50+ items",
			count: Number(globalProductivity?.fiftyPlusCount || 0),
			percentage: Number(
				(
					(Number(globalProductivity?.fiftyPlusCount || 0) /
						Number(globalProductivity?.totalAuthors || 1)) *
					100
				).toFixed(1),
			),
		},
	];

	const authorProductivityStats: AuthorProductivityStats = {
		totalAuthors: Number(globalProductivity?.totalAuthors || 0),
		authorsWithMultipleWorks: Number(
			globalProductivity?.authorsWithMultiple || 0,
		),
		avgItemsPerAuthor: Number(
			Number(globalProductivity?.avgItemsPerAuthor || 0).toFixed(2),
		),
		maxItemsPerAuthor: Number(globalProductivity?.maxItemsPerAuthor || 0),
		productivityDistribution,
	};
	
	return authorProductivityStats;
}

export async function getAuthorCollaborationStats(
	db: Database,
): Promise<AuthorCollaborationStats> {
	const globalCollaborationResult = await db
		.select({
			soloAuthors: sql<number>`count(distinct case when max_collaborators = 0 then author_name end)`,
			collaborativeAuthors: sql<number>`count(distinct case when max_collaborators > 0 then author_name end)`,
			avgCollaborators: sql<number>`avg(max_collaborators)`,
			maxCollaborators: sql<number>`max(max_collaborators)`,
		})
		.from(
			sql`(
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
				max(jsonb_array_length(${item.creators}) - 1) as max_collaborators
			FROM ${item},
			LATERAL jsonb_array_elements(${item.creators}) as creator_data
			WHERE ${item.deleted} = 0 
			AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
			AND ${item.creators} IS NOT NULL
			AND jsonb_array_length(${item.creators}) > 0
			GROUP BY author_name
		) as author_collaboration`,
		)
		.where(
			sql`author_name IS NOT NULL AND author_name != '' AND author_name != 'Unknown Author'`,
		);

	const globalCollaboration = globalCollaborationResult[0];
	const totalAuthorsForCollab =
		Number(globalCollaboration?.soloAuthors || 0) +
		Number(globalCollaboration?.collaborativeAuthors || 0);
	const collaborationRate =
		totalAuthorsForCollab > 0
			? (Number(globalCollaboration?.collaborativeAuthors || 0) /
					totalAuthorsForCollab) *
				100
			: 0;

	const authorCollaborationStats: AuthorCollaborationStats = {
		soloAuthors: Number(globalCollaboration?.soloAuthors || 0),
		collaborativeAuthors: Number(
			globalCollaboration?.collaborativeAuthors || 0,
		),
		avgCollaboratorsPerAuthor: Number(
			Number(globalCollaboration?.avgCollaborators || 0).toFixed(2),
		),
		maxCollaboratorsPerAuthor: Number(
			globalCollaboration?.maxCollaborators || 0,
		),
		collaborationRate: Number(collaborationRate.toFixed(2)),
	};
	
	return authorCollaborationStats;
}

export async function getDetailedAuthorStats(
	db: Database,
	measure: CitationMeasure,
): Promise<AuthorStats[]> {
	const citationCount = citationCountForItem(measure);
	const detailedAuthorStatsResult = await db
		.select({
			authorName: sql<string>`author_name`,
			firstName: sql<string>`first_name`,
			lastName: sql<string>`last_name`,
			itemCount: sql<number>`count(distinct item_key)`,
			totalCitations: sql<number>`coalesce(sum(item_citations), 0)`,
			citationCounts: sql<number[]>`array_agg(item_citations)`,
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
			))`,
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
				) as author_name,
				creator_data->>'firstName' as first_name,
				creator_data->>'lastName' as last_name,
				creator_data->>'creatorType' as creator_type,
				${item.key} as item_key,
				${citationCount} as item_citations,
				${item.date} as item_date,
				institution_data->>'display_name' as institution_name,
				${institutionCountryCode} as country_code
			FROM ${item},
			LATERAL jsonb_array_elements(${item.creators}) as creator_data,
			LATERAL jsonb_array_elements(
				case 
					when creator_data ? 'institutions' and jsonb_typeof(creator_data->'institutions') = 'array' 
					then creator_data->'institutions'
					else '[{}]'::jsonb
				end
			) as institution_data
			${affiliationCountryJoin}
			WHERE ${item.deleted} = 0 
			AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
			AND ${item.creators} IS NOT NULL
			AND jsonb_array_length(${item.creators}) > 0
			AND trim(coalesce(creator_data->>'firstName', '') || ' ' || coalesce(creator_data->>'lastName', '') || ' ' || coalesce(creator_data->>'name', '')) != ''
		) as author_details`,
		)
		.where(
			sql`author_name IS NOT NULL AND author_name != '' AND author_name != 'Unknown Author'`,
		)
		.groupBy(sql`author_name, first_name, last_name`)
		.having(sql`count(distinct item_key) >= 2`) // Only prolific authors
		.orderBy(desc(sql`count(distinct item_key)`))
		.limit(200); // Reduced to top 200 most productive authors

	const authorStats = detailedAuthorStatsResult.map((stat) => {
		const hIndex = calculateHIndex(
			stat.citationCounts?.map((c) => Number(c)) || [],
		);
		const yearSpan =
			stat.lastPublicationYear > stat.firstPublicationYear
			? stat.lastPublicationYear - stat.firstPublicationYear + 1 
			: 1;
		
		// Determine most common creator type
		const creatorTypeCounts = stat.creatorTypes.reduce(
			(acc, type) => {
			acc[type] = (acc[type] || 0) + 1;
			return acc;
			},
			{} as Record<string, number>,
		);
		const mostCommonCreatorType =
			Object.entries(creatorTypeCounts).sort(
				([, a], [, b]) => b - a,
			)[0]?.[0] || "author";

		return {
			authorName: stat.authorName?.trim() || "",
			firstName: stat.firstName || "",
			lastName: stat.lastName || "",
			displayName:
				stat.firstName && stat.lastName
				? `${stat.firstName} ${stat.lastName}`.trim()
					: stat.authorName?.trim() || "",
			itemCount: Number(stat.itemCount),
			totalCitations: Number(stat.totalCitations),
			avgCitationsPerItem:
				Number(stat.itemCount) > 0
					? Number(
							(
								Number(stat.totalCitations) /
								Number(stat.itemCount)
							).toFixed(2),
						)
				: 0,
			hIndex,
			countryCount: Number(stat.countryCount),
			institutionCount: Number(stat.institutionCount),
			creatorTypes: stat.creatorTypes.filter(
				(type) => type && type.trim() !== "",
			),
			mostCommonCreatorType,
			countries: stat.countries.filter(
				(country) => country && country.trim() !== "",
			),
			institutions: stat.institutions.filter(
				(inst) => inst && inst.trim() !== "",
			),
			firstPublicationYear:
				Number(stat.firstPublicationYear) || new Date().getFullYear(),
			lastPublicationYear:
				Number(stat.lastPublicationYear) || new Date().getFullYear(),
			yearSpan,
			mostRecentYear:
				Number(stat.mostRecentYear) || new Date().getFullYear(),
		};
	});
	
	return authorStats;
}
