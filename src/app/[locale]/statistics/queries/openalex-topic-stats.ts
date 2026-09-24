import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db";
import { item } from "@/db/schema/tables/item";
import { resolveTopicAncestry, resolveTopicNodes } from "@/lib/topics/catalog";
import { and, isNotNull, sql } from "drizzle-orm";
import { citationCountForItem, type CitationMeasure } from "./citation-measure";
import type { TopicOverview, TopicStats, TopicYearStats } from "./topic-stats";
import { calculateHIndex, visibleItem, yearOf } from "./utils";

type TopicRecord = {
	itemKey: string;
	topics: string[];
	year: string | null;
	citationCount: number;
};

const PATH_SEPARATOR = " › ";

function topicStatistics(
	rows: readonly TopicRecord[],
	nodes: Awaited<ReturnType<typeof resolveTopicNodes>>,
) {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const children = new Map<string, Set<string>>();
	for (const node of nodes) {
		if (!node.parent) continue;
		const childIds = children.get(node.parent) ?? new Set<string>();
		childIds.add(node.id);
		children.set(node.parent, childIds);
	}

	const citationsByTopic = new Map<string, Map<string, number>>();
	const citationsByTopicYear = new Map<string, Map<string, number>>();
	for (const row of rows) {
		const rowTopicIds = new Set(
			row.topics.flatMap((topicId) => {
				const ids: string[] = [];
				let current = byId.get(topicId);
				while (current) {
					ids.push(current.id);
					current = current.parent
						? byId.get(current.parent)
						: undefined;
				}
				return ids;
			}),
		);
		for (const topicId of rowTopicIds) {
			const citations =
				citationsByTopic.get(topicId) ?? new Map<string, number>();
			citations.set(row.itemKey, Number(row.citationCount || 0));
			citationsByTopic.set(topicId, citations);
			if (row.year) {
				const key = `${topicId}:${row.year}`;
				const yearCitations =
					citationsByTopicYear.get(key) ?? new Map<string, number>();
				yearCitations.set(row.itemKey, Number(row.citationCount || 0));
				citationsByTopicYear.set(key, yearCitations);
			}
		}
	}

	const topicStats = [...citationsByTopic.entries()]
		.flatMap(([id, citations]): TopicStats[] => {
			const node = byId.get(id);
			if (!node) return [];
			const counts = [...citations.values()];
			const totalCitations = counts.reduce(
				(sum, count) => sum + count,
				0,
			);
			return [
				{
					id,
					topic: node.name,
					level: node.path.length,
					parentTopic: node.parent
						? byId.get(node.parent)?.name
						: undefined,
					fullPath: node.path.join(PATH_SEPARATOR),
					itemCount: citations.size,
					totalCitations,
					avgCitationsPerItem: Number(
						(totalCitations / citations.size).toFixed(2),
					),
					hIndex: calculateHIndex(counts),
					isLeaf: node.childCount === 0,
					children: [...(children.get(id) ?? [])].flatMap(
						(childId) => {
							const child = byId.get(childId);
							return child ? [child.name] : [];
						},
					),
				},
			];
		})
		.sort((left, right) => right.itemCount - left.itemCount);

	const topicsByYear = [...citationsByTopicYear.entries()].flatMap(
		([key, citations]): TopicYearStats[] => {
			const separator = key.lastIndexOf(":");
			const id = key.slice(0, separator);
			const year = key.slice(separator + 1);
			const node = byId.get(id);
			if (!node) return [];
			const counts = [...citations.values()];
			const totalCitations = counts.reduce(
				(sum, count) => sum + count,
				0,
			);
			return [
				{
					id,
					topic: node.name,
					fullPath: node.path.join(PATH_SEPARATOR),
					level: node.path.length,
					parentTopic: node.parent
						? byId.get(node.parent)?.name
						: undefined,
					year,
					itemCount: citations.size,
					totalCitations,
					avgCitationsPerItem: Number(
						(totalCitations / citations.size).toFixed(2),
					),
					hIndex: calculateHIndex(counts),
				},
			];
		},
	);

	const maxDepth = Math.max(0, ...topicStats.map((topic) => topic.level));
	const topicOverview: TopicOverview = {
		totalTopics: topicStats.length,
		maxDepth,
		topLevelTopics: topicStats.filter((topic) => topic.level === 1).length,
		avgItemsPerTopic: Number(
			(
				topicStats.reduce((sum, topic) => sum + topic.itemCount, 0) /
				(topicStats.length || 1)
			).toFixed(1),
		),
		topicDistribution: Array.from({ length: maxDepth }, (_, index) => {
			const level = index + 1;
			const count = topicStats.filter(
				(topic) => topic.level === level,
			).length;
			return {
				level,
				count,
				percentage: Number(
					((count / (topicStats.length || 1)) * 100).toFixed(1),
				),
			};
		}),
	};

	return { topicOverview, topicStats, topicsByYear };
}

export async function getOpenAlexTopicStats(
	db: Database,
	config: LibraryServerConfig,
	measure: CitationMeasure,
	hiddenTags: readonly string[],
) {
	if (!config.topics.enabled) {
		return {
			topicStats: [] as TopicStats[],
			topicOverview: {
				totalTopics: 0,
				maxDepth: 0,
				topLevelTopics: 0,
				avgItemsPerTopic: 0,
				topicDistribution: [],
			} satisfies TopicOverview,
			topicsByYear: [] as TopicYearStats[],
		};
	}

	const rows = await db
		.select({
			itemKey: item.key,
			topics: item.topics,
			year: sql<string | null>`${yearOf(item.date)}::text`,
			citationCount: citationCountForItem(measure, hiddenTags),
		})
		.from(item)
		.where(
			and(
				visibleItem(db, hiddenTags),
				isNotNull(item.topics),
				sql`cardinality(${item.topics}) > 0`,
			),
		);
	const topicIds = [...new Set(rows.flatMap((row) => row.topics))];
	const ancestryIds = await resolveTopicAncestry(topicIds, {
		database: db,
		config,
	});
	const nodes = await resolveTopicNodes(ancestryIds, {
		database: db,
		config,
	});
	return topicStatistics(rows, nodes);
}
