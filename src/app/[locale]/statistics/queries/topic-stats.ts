import type { Database } from "@/db";
import { item } from "@/db/schema/tables/item";
import { itemToCollection } from "@/db/schema/tables/itemToCollection";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { calculateHIndex, visibleItem, yearOf } from "./utils";
import { citationCountForItem, type CitationMeasure } from "./citation-measure";

export type TopicStats = {
	/** The collection keys from the top down: titles need not be unique, so topics are told apart by these. */
	id: string;
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

export type TopicOverview = {
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

export type TopicYearStats = {
	id: string;
	topic: string;
	fullPath: string;
	level: number;
	parentTopic?: string;
	year: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
};

/** The collections a library shows, by key: the public title and the shown collection it sits in. */
export type ShownCollections = ReadonlyMap<string, { title: string; parent?: string }>;

/** Joins titles into a path; a title may itself contain "/", so paths use a separator titles do not. */
const PATH_SEPARATOR = " \u203a ";

/**
 * Topics are the collections a publication is in, named by their public titles along the shown collections above
 * them. A collection the library does not show is not a topic, so internal folders and bare keys never appear.
 */
export function topicPaths(collectionKey: string, shown: ShownCollections) {
	const keys: string[] = [];
	const titles: string[] = [];
	for (let key: string | undefined = collectionKey; key && titles.length < 20; key = shown.get(key)?.parent) {
		const entry = shown.get(key);
		if (!entry) break;
		keys.unshift(key);
		titles.unshift(entry.title);
	}
	return titles.map((topic, index) => ({
		id: keys.slice(0, index + 1).join("/"),
		parentId: index > 0 ? keys.slice(0, index).join("/") : undefined,
		topic,
		fullPath: titles.slice(0, index + 1).join(PATH_SEPARATOR),
		level: index + 1,
		parentTopic: index > 0 ? titles[index - 1] : undefined,
	}));
}

export async function getTopicStats(
	db: Database,
	measure: CitationMeasure,
	shown: ShownCollections,
	hiddenTags: readonly string[],
): Promise<{ topicStats: TopicStats[]; topicOverview: TopicOverview }> {
	const topicStatsResult = await db
		.select({
			collections: sql<
				string[]
			>`array_agg(${itemToCollection.collectionKey})`,
			itemKey: item.key,
			citationCount: citationCountForItem(measure, hiddenTags),
		})
		.from(item)
		.innerJoin(itemToCollection, eq(itemToCollection.itemKey, item.key))
		.where(visibleItem(db, hiddenTags))
		.groupBy(item.key);

	// Process hierarchical topic structure
	const topicMap = new Map<
		string,
		{
		topic: string;
		fullPath: string;
		level: number;
		parentTopic?: string;
		/** Each publication once with its citations, however many of the topic's collections it is in. */
		citations: Map<string, number>;
		children: Set<string>;
		}
	>();

	// Extract all topics and their hierarchy
	topicStatsResult.forEach((row) => {
		if (!row.collections || row.collections.length === 0) return;
		
		row.collections.forEach((collection: string) => {
			// Build hierarchical paths
			for (const path of topicPaths(collection, shown)) {
				if (!topicMap.has(path.id)) {
					topicMap.set(path.id, {
						topic: path.topic,
						fullPath: path.fullPath,
						level: path.level,
						parentTopic: path.parentTopic,
						citations: new Map(),
						children: new Set(),
					});
				}
				
				topicMap.get(path.id)!.citations.set(row.itemKey, Number(row.citationCount || 0));
				
				// Add child relationship
				if (path.parentId && topicMap.has(path.parentId)) {
					topicMap.get(path.parentId)!.children.add(path.id);
				}
			}
		});
	});

	// Calculate statistics for each topic
	const topicStats: TopicStats[] = Array.from(topicMap.entries())
		.map(([id, data]) => {
		const uniqueCitationCounts = [...data.citations.values()];
			const totalCitations = uniqueCitationCounts.reduce(
				(sum, count) => sum + count,
				0,
			);
			const avgCitations =
				data.citations.size > 0
					? totalCitations / data.citations.size
					: 0;
		const hIndex = calculateHIndex(uniqueCitationCounts);

		return {
			id,
			topic: data.topic,
			level: data.level,
				parentTopic: data.parentTopic,
			fullPath: data.fullPath,
			itemCount: data.citations.size,
			totalCitations,
			avgCitationsPerItem: Number(avgCitations.toFixed(2)),
			hIndex,
			isLeaf: data.children.size === 0,
				// Children by name for display; the set holds their ids, so two children sharing a name both count.
				children: Array.from(data.children, (child) => topicMap.get(child)?.topic ?? child),
		};
		})
		.sort((a, b) => b.itemCount - a.itemCount);

	// Calculate topic overview statistics
	const maxDepth = Math.max(
		0,
		...Array.from(topicMap.values()).map((t) => t.level),
	);
	const topLevelTopics = Array.from(topicMap.values()).filter(
		(t) => t.level === 1,
	).length;
	// Only publications in a shown topic: one whose collections are all hidden is in no topic.
	// The mean of the topics' own counts, as the year view computes it.
	const avgItemsPerTopic =
		topicStats.length > 0 ? topicStats.reduce((sum, topic) => sum + topic.itemCount, 0) / topicStats.length : 0;

	// Calculate distribution by level
	const levelCounts = new Map<number, number>();
	for (let level = 1; level <= maxDepth; level++) {
		levelCounts.set(
			level,
			Array.from(topicMap.values()).filter((t) => t.level === level)
				.length,
		);
	}

	const topicDistribution = Array.from(levelCounts.entries()).map(
		([level, count]) => ({
		level,
		count,
			percentage: Number(((count / topicStats.length) * 100).toFixed(1)),
		}),
	);

	const topicOverview: TopicOverview = {
		totalTopics: topicStats.length,
		maxDepth,
		topLevelTopics,
		avgItemsPerTopic: Number(avgItemsPerTopic.toFixed(1)),
		topicDistribution,
	};

	return { topicStats, topicOverview };
}

export async function getTopicStatsByYear(
	db: Database,
	measure: CitationMeasure,
	shown: ShownCollections,
	hiddenTags: readonly string[],
): Promise<TopicYearStats[]> {
	const topicsByYearResult = await db
		.select({
			collections: sql<
				string[]
			>`array_agg(${itemToCollection.collectionKey})`,
			itemKey: item.key,
			year: sql<string>`${yearOf(item.date)}::text`,
			citationCount: citationCountForItem(measure, hiddenTags),
		})
		.from(item)
		.innerJoin(itemToCollection, eq(itemToCollection.itemKey, item.key))
		.where(
			and(
				visibleItem(db, hiddenTags),
				isNotNull(item.date),
				sql`${item.date} ~ '^[0-9]{4}'`,
				sql`${yearOf(item.date)} >= 2000`,
			),
			)
		.groupBy(item.key, item.date);

	// Process hierarchical topic structure with yearly breakdown
	const topicYearMap = new Map<
		string,
		{
		id: string;
		topic: string;
		fullPath: string;
		level: number;
		parentTopic?: string;
		year: string;
		citations: Map<string, number>;
		}
	>();

	// Extract all topics and their hierarchy with year information
	topicsByYearResult.forEach((row) => {
		if (!row.collections || row.collections.length === 0 || !row.year)
			return;
		
		row.collections.forEach((collection: string) => {
			// Build hierarchical paths for each level
			for (const path of topicPaths(collection, shown)) {
				const key = `${path.id}-${row.year}`;
				
				if (!topicYearMap.has(key)) {
					topicYearMap.set(key, {
						id: path.id,
						topic: path.topic,
						fullPath: path.fullPath,
						level: path.level,
						parentTopic: path.parentTopic,
						year: row.year,
						citations: new Map(),
					});
				}
				
				topicYearMap.get(key)!.citations.set(row.itemKey, Number(row.citationCount || 0));
			}
		});
	});

	// Calculate statistics for each topic-year combination
	const topicYearStats: TopicYearStats[] = Array.from(topicYearMap.values())
		.map((data) => {
		const citationCounts = [...data.citations.values()];
			const totalCitations = citationCounts.reduce(
				(sum, count) => sum + count,
				0,
			);
			const avgCitations =
				data.citations.size > 0
					? totalCitations / data.citations.size
					: 0;
		const hIndex = calculateHIndex(citationCounts);
		
		return {
			id: data.id,
			topic: data.topic,
			fullPath: data.fullPath,
			level: data.level,
			parentTopic: data.parentTopic,
			year: data.year,
			itemCount: data.citations.size,
			totalCitations,
			avgCitationsPerItem: Number(avgCitations.toFixed(2)),
				hIndex,
		};
		})
		.sort((a, b) => {
		// Sort by year (desc) then by item count (desc)
		const yearCompare = parseInt(b.year) - parseInt(a.year);
		if (yearCompare !== 0) return yearCompare;
		return b.itemCount - a.itemCount;
	});

	return topicYearStats;
}
