import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db";
import { item } from "@/db/schema/tables/item";
import { resolveTopicAncestry } from "@/lib/topics/catalog";
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

type TopicNodes = Awaited<ReturnType<typeof resolveTopicAncestry>>;
type TopicNodeById = Map<string, TopicNodes[number]>;

function topicChildren(nodes: TopicNodes) {
	const children = new Map<string, Set<string>>();
	for (const node of nodes) {
		if (!node.parent) continue;
		const childIds = children.get(node.parent) ?? new Set<string>();
		childIds.add(node.id);
		children.set(node.parent, childIds);
	}
	return children;
}

/** The topic and every topic above it. */
function topicAncestorIds(byId: TopicNodeById, topicId: string) {
	const ids: string[] = [];
	let current = byId.get(topicId);
	while (current) {
		ids.push(current.id);
		current = current.parent ? byId.get(current.parent) : undefined;
	}
	return ids;
}

function addCitation(
	citationsByKey: Map<string, Map<string, number>>,
	key: string,
	row: TopicRecord,
) {
	const citations = citationsByKey.get(key) ?? new Map<string, number>();
	citations.set(row.itemKey, Number(row.citationCount || 0));
	citationsByKey.set(key, citations);
}

function topicCitations(rows: readonly TopicRecord[], byId: TopicNodeById) {
	const citationsByTopic = new Map<string, Map<string, number>>();
	const citationsByTopicYear = new Map<string, Map<string, number>>();
	for (const row of rows) {
		const rowTopicIds = new Set(
			row.topics.flatMap((topicId) => topicAncestorIds(byId, topicId)),
		);
		for (const topicId of rowTopicIds) {
			addCitation(citationsByTopic, topicId, row);
			if (row.year) {
				addCitation(citationsByTopicYear, `${topicId}:${row.year}`, row);
			}
		}
	}
	return { citationsByTopic, citationsByTopicYear };
}

/** The figures a topic shows, from the citation count of each of its items. */
function topicFigures(
	node: TopicNodes[number],
	byId: TopicNodeById,
	citations: Map<string, number>,
) {
	const counts = [...citations.values()];
	const totalCitations = counts.reduce((sum, count) => sum + count, 0);
	return {
		id: node.id,
		topic: node.name,
		level: node.path.length,
		parentTopic: node.parent ? byId.get(node.parent)?.name : undefined,
		fullPath: node.path.join(PATH_SEPARATOR),
		itemCount: citations.size,
		totalCitations,
		avgCitationsPerItem: Number(
			(totalCitations / citations.size).toFixed(2),
		),
		hIndex: calculateHIndex(counts),
	};
}

function topicOverview(topicStats: readonly TopicStats[]): TopicOverview {
	const maxDepth = Math.max(0, ...topicStats.map((topic) => topic.level));
	return {
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
}

function topicStatistics(rows: readonly TopicRecord[], nodes: TopicNodes) {
	const byId: TopicNodeById = new Map(nodes.map((node) => [node.id, node]));
	const children = topicChildren(nodes);
	const { citationsByTopic, citationsByTopicYear } = topicCitations(
		rows,
		byId,
	);

	const topicStats = [...citationsByTopic.entries()]
		.flatMap(([id, citations]): TopicStats[] => {
			const node = byId.get(id);
			if (!node) return [];
			return [
				{
					...topicFigures(node, byId, citations),
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
			const node = byId.get(key.slice(0, separator));
			if (!node) return [];
			return [
				{
					...topicFigures(node, byId, citations),
					year: key.slice(separator + 1),
				},
			];
		},
	);

	return {
		topicOverview: topicOverview(topicStats),
		topicStats,
		topicsByYear,
	};
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
	const nodes = await resolveTopicAncestry(topicIds, {
		database: db,
		config,
	});
	return topicStatistics(rows, nodes);
}
