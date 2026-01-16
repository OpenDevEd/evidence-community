import { db } from "@/db";
import { item } from "@/db/schema/tables/item";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { calculateHIndex } from "./utils";

export type TopicStats = {
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
	topic: string;
	fullPath: string;
	year: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
};

export async function getTopicStats(): Promise<{ topicStats: TopicStats[]; topicOverview: TopicOverview }> {
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

	return { topicStats, topicOverview };
}

export async function getTopicStatsByYear(): Promise<TopicYearStats[]> {
	const topicsByYearResult = await db
		.select({
			collections: item.collections,
			itemKey: item.key,
			year: sql<string>`extract(year from to_date(${item.date}, 'YYYY-MM-DD'))::text`,
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
				sql`array_length(${item.collections}, 1) > 0`,
				isNotNull(item.date),
				sql`${item.date} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
				sql`extract(year from to_date(${item.date}, 'YYYY-MM-DD')) >= 2000`
			)
		);

	// Process hierarchical topic structure with yearly breakdown
	const topicYearMap = new Map<string, {
		topic: string;
		fullPath: string;
		year: string;
		itemKeys: Set<string>;
		citationCounts: number[];
	}>();

	// Extract all topics and their hierarchy with year information
	topicsByYearResult.forEach((row) => {
		if (!row.collections || row.collections.length === 0 || !row.year) return;
		
		row.collections.forEach((collection: string) => {
			if (!collection || collection.trim() === '') return;
			
			const parts = collection.split('/').map(part => part.trim()).filter(part => part !== '');
			
			// Build hierarchical paths for each level
			for (let i = 0; i < parts.length; i++) {
				const fullPath = parts.slice(0, i + 1).join('/');
				const topicName = parts[i];
				const key = `${fullPath}-${row.year}`;
				
				if (!topicYearMap.has(key)) {
					topicYearMap.set(key, {
						topic: topicName,
						fullPath: fullPath,
						year: row.year,
						itemKeys: new Set(),
						citationCounts: []
					});
				}
				
				const topicData = topicYearMap.get(key)!;
				topicData.itemKeys.add(row.itemKey);
				topicData.citationCounts.push(row.citationCount || 0);
			}
		});
	});

	// Calculate statistics for each topic-year combination
	const topicYearStats: TopicYearStats[] = Array.from(topicYearMap.values()).map((data) => {
		const uniqueItemKeys = Array.from(data.itemKeys);
		const totalCitations = data.citationCounts.reduce((sum, count) => sum + count, 0);
		const avgCitations = uniqueItemKeys.length > 0 ? totalCitations / uniqueItemKeys.length : 0;
		const hIndex = calculateHIndex(data.citationCounts);
		
		return {
			topic: data.topic,
			fullPath: data.fullPath,
			year: data.year,
			itemCount: uniqueItemKeys.length,
			totalCitations,
			avgCitationsPerItem: Number(avgCitations.toFixed(2)),
			hIndex
		};
	}).sort((a, b) => {
		// Sort by year (desc) then by item count (desc)
		const yearCompare = parseInt(b.year) - parseInt(a.year);
		if (yearCompare !== 0) return yearCompare;
		return b.itemCount - a.itemCount;
	});

	return topicYearStats;
} 