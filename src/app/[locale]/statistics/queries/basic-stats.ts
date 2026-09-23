import type { Database } from "@/db";
import { item } from "@/db/schema/tables/item";
import { citationCountForItem, type CitationMeasure } from "./citation-measure";
import { itemInstitution } from "@/db/schema/tables/itemInstitution";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { eq, isNotNull, and, ne, sql, desc, gte } from "drizzle-orm";
import { yearOf } from "./utils";

export type ItemTypeStats = {
	itemType: string;
	count: number;
	percentage: number;
};

export type YearStats = {
	year: string;
	count: number;
};

export type FieldStats = {
	field: string;
	filledCount: number;
	percentage: number;
};

export type AttachmentStats = {
	totalAttachments: number;
	itemsWithAttachments: number;
	attachmentPercentage: number;
};

export type CitationYearStats = {
	year: string;
	totalCitations: number;
	itemCount: number;
	avgCitationsPerItem: number;
};

export async function getTotalItems(db: Database): Promise<number> {
	const totalItemsResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(item)
		.where(
			and(
				eq(item.deleted, 0),
				sql`(${item.parentItem} IS NULL OR ${item.parentItem} = '')`,
			),
		);

	const totalItems = totalItemsResult[0]?.count || 0;

	return Number(totalItems);
}

export async function getAvailableYears(db: Database): Promise<string[]> {
	const availableYearsResult = await db
		.select({
			year: sql<string>`${yearOf(item.date)}::text`,
			count: sql<number>`count(*)`,
		})
		.from(item)
		.where(
			and(
				eq(item.deleted, 0),
				isNotNull(item.date),
				ne(item.date, ""),
				sql`(${item.parentItem} IS NULL OR ${item.parentItem} = '')`,
				sql`${item.date} ~ '^[0-9]{4}'`, // Any date that starts with its year, as the listing's year filter counts it
			),
		)
		.groupBy(
			sql`${yearOf(item.date)}`,
		)
		.having(sql`count(*) >= 10`) // Only include years with at least 10 publications
		.orderBy(
			desc(sql`${yearOf(item.date)}`),
		)
		.limit(20); // Limit to last 20 years with data

	return availableYearsResult.map((stat) => stat.year || "");
}

export async function getItemTypeStats(
	db: Database,
	totalItems: number,
): Promise<ItemTypeStats[]> {
	const itemTypeStatsResult = await db
		.select({
			itemType: item.itemType,
			count: sql<number>`count(*)`,
		})
		.from(item)
		.where(
			and(
				eq(item.deleted, 0),
				sql`(${item.parentItem} IS NULL OR ${item.parentItem} = '')`,
			),
		)
		.groupBy(item.itemType)
		.orderBy(desc(sql`count(*)`));

	const itemTypes = itemTypeStatsResult.map((stat) => ({
		itemType: stat.itemType,
		count: Number(stat.count),
		percentage:
			totalItems > 0
				? Number(((Number(stat.count) / totalItems) * 100).toFixed(2))
				: 0,
	}));

	return itemTypes;
}

export async function getYearDistribution(db: Database): Promise<YearStats[]> {
	const yearStatsResult = await db
		.select({
			year: sql<string>`${yearOf(item.date)}::text`,
			count: sql<number>`count(*)`,
		})
		.from(item)
		.where(
			and(
				eq(item.deleted, 0),
				isNotNull(item.date),
				ne(item.date, ""),
				sql`(${item.parentItem} IS NULL OR ${item.parentItem} = '')`,
				sql`${item.date} ~ '^[0-9]{4}'`, // Any date that starts with its year, as the listing's year filter counts it
			),
		)
		.groupBy(
			sql`${yearOf(item.date)}`,
		)
		.orderBy(
			desc(sql`${yearOf(item.date)}`),
		)
		.limit(20);

	return yearStatsResult.map((stat) => ({
		year: stat.year || "",
		count: Number(stat.count),
	}));
}

export async function getFieldCompleteness(
	db: Database,
	totalItems: number,
): Promise<FieldStats[]> {
	const fieldCompletenessResult = await db
		.select({
			titleFilled: sql<number>`count(case when ${item.title} is not null and ${item.title} != '' then 1 end)`,
			abstractFilled: sql<number>`count(case when ${item.abstractNote} is not null and ${item.abstractNote} != '' then 1 end)`,
			doiFilled: sql<number>`count(case when ${item.DOI} is not null and ${item.DOI} != '' then 1 end)`,
			urlFilled: sql<number>`count(case when ${item.url} is not null and ${item.url} != '' then 1 end)`,
			dateFilled: sql<number>`count(case when ${item.date} is not null and ${item.date} != '' then 1 end)`,
			institutionFilled: sql<number>`count(case when exists (
				select 1 from ${itemInstitution}
				where ${itemInstitution.itemKey} = ${item.key}
				and ${itemInstitution.source} = 'record'
			) then 1 end)`,
			creatorsFilled: sql<number>`count(case when ${item.creators} is not null then 1 end)`,
			pagesFilled: sql<number>`count(case when ${item.pages} is not null and ${item.pages} != '' then 1 end)`,
			volumeFilled: sql<number>`count(case when ${item.volume} is not null and ${item.volume} != '' then 1 end)`,
			issueFilled: sql<number>`count(case when ${item.issue} is not null and ${item.issue} != '' then 1 end)`,
			collectionsFilled: sql<number>`count(case when exists (
				select 1 from ${itemToCollection}
				where ${itemToCollection.itemKey} = ${item.key}
			) then 1 end)`,
			languageFilled: sql<number>`count(case when ${item.languageName} is not null and ${item.languageName} != '' then 1 end)`,
		})
		.from(item)
		.where(
			and(
				eq(item.deleted, 0),
				sql`(${item.parentItem} IS NULL OR ${item.parentItem} = '')`,
			),
		);

	const fieldStats = fieldCompletenessResult[0];
	const fieldCompleteness = [
		{
			field: "title",
			filledCount: Number(fieldStats?.titleFilled || 0),
			percentage: Number(
				(
					(Number(fieldStats?.titleFilled || 0) / totalItems) *
					100
				).toFixed(2),
			),
		},
		{
			field: "abstractNote",
			filledCount: Number(fieldStats?.abstractFilled || 0),
			percentage: Number(
				(
					(Number(fieldStats?.abstractFilled || 0) / totalItems) *
					100
				).toFixed(2),
			),
		},
		{
			field: "DOI",
			filledCount: Number(fieldStats?.doiFilled || 0),
			percentage: Number(
				(
					(Number(fieldStats?.doiFilled || 0) / totalItems) *
					100
				).toFixed(2),
			),
		},
		{
			field: "url",
			filledCount: Number(fieldStats?.urlFilled || 0),
			percentage: Number(
				(
					(Number(fieldStats?.urlFilled || 0) / totalItems) *
					100
				).toFixed(2),
			),
		},
		{
			field: "date",
			filledCount: Number(fieldStats?.dateFilled || 0),
			percentage: Number(
				(
					(Number(fieldStats?.dateFilled || 0) / totalItems) *
					100
				).toFixed(2),
			),
		},
		{
			field: "institution",
			filledCount: Number(fieldStats?.institutionFilled || 0),
			percentage: Number(
				(
					(Number(fieldStats?.institutionFilled || 0) / totalItems) *
					100
				).toFixed(2),
			),
		},
		{
			field: "creators",
			filledCount: Number(fieldStats?.creatorsFilled || 0),
			percentage: Number(
				(
					(Number(fieldStats?.creatorsFilled || 0) / totalItems) *
					100
				).toFixed(2),
			),
		},
		{
			field: "pages",
			filledCount: Number(fieldStats?.pagesFilled || 0),
			percentage: Number(
				(
					(Number(fieldStats?.pagesFilled || 0) / totalItems) *
					100
				).toFixed(2),
			),
		},
		{
			field: "volume",
			filledCount: Number(fieldStats?.volumeFilled || 0),
			percentage: Number(
				(
					(Number(fieldStats?.volumeFilled || 0) / totalItems) *
					100
				).toFixed(2),
			),
		},
		{
			field: "issue",
			filledCount: Number(fieldStats?.issueFilled || 0),
			percentage: Number(
				(
					(Number(fieldStats?.issueFilled || 0) / totalItems) *
					100
				).toFixed(2),
			),
		},
		{
			field: "collections",
			filledCount: Number(fieldStats?.collectionsFilled || 0),
			percentage: Number(
				(
					(Number(fieldStats?.collectionsFilled || 0) / totalItems) *
					100
				).toFixed(2),
			),
		},
		{
			field: "languageName",
			filledCount: Number(fieldStats?.languageFilled || 0),
			percentage: Number(
				(
					(Number(fieldStats?.languageFilled || 0) / totalItems) *
					100
				).toFixed(2),
			),
		},
	];

	return fieldCompleteness;
}

export async function getAttachmentStats(
	db: Database,
	totalItems: number,
): Promise<AttachmentStats> {
	const attachmentStatsResult = await db
		.select({
			totalAttachments: sql<number>`count(case when ${item.parentItem} is not null and ${item.parentItem} != '' then 1 end)`,
			itemsWithAttachments: sql<number>`count(distinct case when ${item.parentItem} is not null and ${item.parentItem} != '' then ${item.parentItem} end)`,
		})
		.from(item)
		.where(eq(item.deleted, 0));

	const attachmentStats = {
		totalAttachments: Number(
			attachmentStatsResult[0]?.totalAttachments || 0,
		),
		itemsWithAttachments: Number(
			attachmentStatsResult[0]?.itemsWithAttachments || 0,
		),
		attachmentPercentage:
			totalItems > 0
				? Number(
						(
							(Number(
								attachmentStatsResult[0]
									?.itemsWithAttachments || 0,
							) /
								totalItems) *
							100
						).toFixed(2),
					)
				: 0,
	};

	return attachmentStats;
}

export async function getPublishersAndJournals(db: Database): Promise<{
	topPublishers: { publisher: string; count: number }[];
	topJournals: { journal: string; count: number }[];
	languageDistribution: { language: string; count: number }[];
}> {
	const topPublishersResult = await db
		.select({
			publisher: item.publisher,
			count: sql<number>`count(*)`,
		})
		.from(item)
		.where(
			and(
				eq(item.deleted, 0),
				isNotNull(item.publisher),
				ne(item.publisher, ""),
				sql`(${item.parentItem} IS NULL OR ${item.parentItem} = '')`,
			),
		)
		.groupBy(item.publisher)
		.orderBy(desc(sql`count(*)`))
		.limit(15);

	// Get top journals
	const topJournalsResult = await db
		.select({
			journal: item.publicationTitle,
			count: sql<number>`count(*)`,
		})
		.from(item)
		.where(
			and(
				eq(item.deleted, 0),
				isNotNull(item.publicationTitle),
				ne(item.publicationTitle, ""),
				sql`(${item.parentItem} IS NULL OR ${item.parentItem} = '')`,
			),
		)
		.groupBy(item.publicationTitle)
		.orderBy(desc(sql`count(*)`))
		.limit(15);

	// Get language distribution
	const languageDistributionResult = await db
		.select({
			language: item.languageName,
			count: sql<number>`count(*)`,
		})
		.from(item)
		.where(
			and(
				eq(item.deleted, 0),
				isNotNull(item.languageName),
				ne(item.languageName, ""),
				sql`(${item.parentItem} IS NULL OR ${item.parentItem} = '')`,
			),
		)
		.groupBy(item.languageName)
		.orderBy(desc(sql`count(*)`))
		.limit(10);

	return {
		topPublishers: topPublishersResult.map((stat) => ({
			publisher: stat.publisher || "",
			count: Number(stat.count),
		})),
		topJournals: topJournalsResult.map((stat) => ({
			journal: stat.journal || "",
			count: Number(stat.count),
		})),
		languageDistribution: languageDistributionResult.map((stat) => ({
			language: stat.language || "",
			count: Number(stat.count),
		})),
	};
}

export async function getRecentActivity(
	db: Database,
): Promise<{ date: string; count: number }[]> {
	const recentActivityResult = await db
		.select({
			date: sql<string>`DATE(${item.dateAdded})`,
			count: sql<number>`count(*)`,
		})
		.from(item)
		.where(
			and(
				eq(item.deleted, 0),
				sql`(${item.parentItem} IS NULL OR ${item.parentItem} = '')`,
				sql`${item.dateAdded} >= CURRENT_DATE - INTERVAL '30 days'`,
			),
		)
		.groupBy(sql`DATE(${item.dateAdded})`)
		.orderBy(desc(sql`DATE(${item.dateAdded})`));

	return recentActivityResult.map((activity) => ({
		date: activity.date || "",
		count: Number(activity.count),
	}));
}

export async function getCitationsByYear(
	db: Database,
	measure: CitationMeasure,
): Promise<CitationYearStats[]> {
	const citationCount = citationCountForItem(measure);
	const citationsByYearResult = await db
		.select({
			year: sql<string>`${yearOf(item.date)}::text`,
			itemCount: sql<number>`count(*)`,
			totalCitations: sql<number>`coalesce(sum(${citationCount}), 0)`,
			avgCitationsPerItem: sql<number>`coalesce(avg(${citationCount}), 0)`,
		})
		.from(item)
		.where(
			and(
				eq(item.deleted, 0),
				sql`(${item.parentItem} IS NULL OR ${item.parentItem} = '')`,
				isNotNull(item.date),
				sql`${item.date} ~ '^[0-9]{4}'`,
				sql`${yearOf(item.date)} >= 2000`,
			),
		)
		.groupBy(
			sql`${yearOf(item.date)}::text`,
		)
		.orderBy(
			desc(
				sql`${yearOf(item.date)}::text`,
			),
		);

	return citationsByYearResult.map((stat) => ({
		year: stat.year || "",
		totalCitations: Number(stat.totalCitations),
		itemCount: Number(stat.itemCount),
		avgCitationsPerItem: Number(
			(Number(stat.avgCitationsPerItem) || 0).toFixed(2),
		),
	}));
}
