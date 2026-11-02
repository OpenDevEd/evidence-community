import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Bookmark02Icon, ChartIncreaseIcon, Layers01Icon, Search01Icon, TagsIcon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { motion } from "framer-motion";
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from "@/components/nextui/Table";
import { Input } from "@/components/nextui/Input";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Pagination } from "@/components/nextui/Pagination";
import { Card } from "@/components/nextui/Card";
import { SectionCard } from "./SectionCard";
import { DistributionBarChart } from "./DistributionBarChart";
import { TopicStats, TopicOverview, TopicYearStats } from "./types";

type TopicKind = "collections" | "topics";

type ResearchTopicsProps = {
	topicStats: TopicStats[];
	topicOverview: TopicOverview;
	topicsByYear?: TopicYearStats[];
	kind?: TopicKind;
};

const itemVariants = {
	hidden: { y: 20, opacity: 0 },
	show: { y: 0, opacity: 1 },
};

/** Levels one to three have their own colour; every deeper level shares the fourth. */
const LEVEL_DOT_CLASSES = ["bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-purple-500"];
const LEVEL_BADGE_CLASSES = [
	"bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200",
	"bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200",
	"bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200",
	"bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200",
];

function levelClass(classes: readonly string[], level: number) {
	return classes[level - 1] ?? classes[3];
}

function rankBadgeClass(index: number) {
	return index < 3
		? "bg-gradient-to-r from-amber-400 to-amber-600 text-white"
		: "bg-black/10 dark:bg-white/10 text-black/60 dark:text-white/60";
}

const TILE_TONES = {
	blue: { tile: "from-blue-500/10 to-blue-600/5 border border-blue-500/20", value: "text-blue-600 dark:text-blue-400" },
	emerald: { tile: "from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20", value: "text-emerald-600 dark:text-emerald-400" },
	amber: { tile: "from-amber-500/10 to-amber-600/5 border border-amber-500/20", value: "text-amber-600 dark:text-amber-400" },
	purple: { tile: "from-purple-500/10 to-purple-600/5 border border-purple-500/20", value: "text-purple-600 dark:text-purple-400" },
};

function useTopicLabels(kind: TopicKind) {
	const t = useTranslations("ui");
	const tStats = useTranslations("statistics");
	if (kind === "collections") {
		return {
			title: t("collections"),
			total: t("collections"),
			topLevel: tStats("collectionNotes.topLevel"),
			topLevelNote: tStats("collectionNotes.topLevelNote"),
			avgItems: tStats("collectionNotes.avgItems"),
			avgItemsNote: tStats("collectionNotes.avgItemsNote"),
			distribution: tStats("collectionNotes.distribution"),
			countUnit: t("collections").toLowerCase(),
			topByImpact: tStats("collectionNotes.topByImpact"),
			topLevelAreas: tStats("collectionNotes.topLevel"),
			children: tStats("collectionNotes.children"),
			all: t("collections"),
			search: t("searchCollections"),
			searchPlaceholder: tStats("collectionNotes.searchPlaceholder"),
			table: tStats("collectionNotes.table"),
			column: t("collections"),
		};
	}
	return {
		title: t("researchTopics"),
		total: t("totalTopics"),
		topLevel: t("topLevelTopics"),
		topLevelNote: t("mainResearchAreas"),
		avgItems: t("avgItemsPerTopic"),
		avgItemsNote: t("publicationsPerTopic"),
		distribution: t("topicDistributionByLevel"),
		countUnit: t("topicsLowercase"),
		topByImpact: t("topTopicsByImpact"),
		topLevelAreas: t("topLevelResearchAreas"),
		children: t("subtopicsLowercase"),
		all: t("allResearchTopics"),
		search: t("searchTopics"),
		searchPlaceholder: t("searchByTopicNameOrPath"),
		table: t("topicsStatisticsTable"),
		column: t("topicColumn"),
	};
}

type TopicLabels = ReturnType<typeof useTopicLabels>;

/** The overview figures for one year are counted from its topics; for every year they come precomputed. */
function overviewFigures(topics: TopicStats[], topicOverview: TopicOverview, selectedYear: string) {
	if (selectedYear === "all") {
		return { maxDepth: topicOverview.maxDepth, avgItems: topicOverview.avgItemsPerTopic };
	}
	return {
		maxDepth: Math.max(...topics.map(t => t.level), 0),
		avgItems: topics.length > 0
			? (topics.reduce((sum, t) => sum + t.itemCount, 0) / topics.length).toFixed(1)
			: "0",
	};
}

function OverviewTile({
	tone,
	value,
	label,
	note,
	inYear,
}: {
	tone: keyof typeof TILE_TONES;
	value: string | number;
	label: string;
	note: string;
	inYear: string | undefined;
}) {
	return (
		<motion.div variants={itemVariants} className={`text-center p-6 rounded-2xl bg-gradient-to-br ${TILE_TONES[tone].tile}`}>
			<div className={`text-3xl font-bold ${TILE_TONES[tone].value} mb-2`}>
				{value}
			</div>
			<div className="text-sm font-medium text-black/60 dark:text-white/60">
				{label}
			</div>
			<div className="text-xs text-black/40 dark:text-white/40 mt-1">
				{inYear ?? note}
			</div>
		</motion.div>
	);
}

function TopicOverviewTiles({
	topics,
	topicOverview,
	selectedYear,
	labels,
}: {
	topics: TopicStats[];
	topicOverview: TopicOverview;
	selectedYear: string;
	labels: TopicLabels;
}) {
  const locale = useLocale();
	const t = useTranslations("ui");
	const inYear = selectedYear === "all" ? undefined : t("inYear", { year: selectedYear });
	const { maxDepth, avgItems } = overviewFigures(topics, topicOverview, selectedYear);
	return (
		<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
			<OverviewTile
				tone="blue"
				value={topics.length.toLocaleString(locale)}
				label={labels.total}
				note={t("allHierarchicalLevels")}
				inYear={inYear}
			/>
			<OverviewTile
				tone="emerald"
				value={topics.filter(t => t.level === 1).length.toLocaleString(locale)}
				label={labels.topLevel}
				note={labels.topLevelNote}
				inYear={inYear}
			/>
			<OverviewTile
				tone="amber"
				value={maxDepth}
				label={t("maxDepth")}
				note={t("hierarchicalLevels")}
				inYear={inYear}
			/>
			<OverviewTile
				tone="purple"
				value={avgItems}
				label={labels.avgItems}
				note={labels.avgItemsNote}
				inYear={inYear}
			/>
		</div>
	);
}

function LevelDistribution({ topicOverview, labels }: { topicOverview: TopicOverview; labels: TopicLabels }) {
  const locale = useLocale();
	const t = useTranslations("ui");
	return (
		<motion.div variants={itemVariants} className="space-y-4">
			<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
				<HugeiconsIcon icon={Layers01Icon} className="text-accent" />
				{labels.distribution}
			</h3>
			<DistributionBarChart
				data={topicOverview.topicDistribution}
				xAxis={{
					dataKey: "level",
					tick: { fontSize: 12 },
					tickFormatter: (value) => `Level ${value}`,
				}}
				formatter={(value: number, name: string, props: any) => [
					`${value.toLocaleString(locale)} ${labels.countUnit} (${props.payload.percentage}%)`,
					t("levelNumber", { number: props.payload.level })
				]}
			/>
		</motion.div>
	);
}

function TopTopicsByImpact({ topics, labels }: { topics: TopicStats[]; labels: TopicLabels }) {
  const locale = useLocale();
	const t = useTranslations("ui");
	return (
		<motion.div variants={itemVariants} className="space-y-4">
			<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
				<HugeiconsIcon icon={ChartIncreaseIcon} className="text-accent" />
				{labels.topByImpact}
			</h3>
			<Card color="card" className="p-6">
				<div className="space-y-4 h-96 overflow-y-auto">
					{topics.slice(0, 20).map((topic, index) => (
						<motion.div
							key={index}
							variants={itemVariants}
							className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-black/5 to-transparent dark:from-white/5 border border-black/10 dark:border-white/10 hover:border-accent/30 transition-colors duration-300"
						>
							<div className="flex items-center gap-3 flex-1 min-w-0">
								<div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${rankBadgeClass(index)}`}>
									{index + 1}
								</div>
								<div className="flex items-center gap-2">
									<div className={`w-2 h-2 rounded-full ${levelClass(LEVEL_DOT_CLASSES, topic.level)}`} />
								</div>
								<div className="flex-1 min-w-0">
									<div className="font-semibold text-black dark:text-white text-sm truncate">
										{topic.topic}
									</div>
									<div className="text-xs text-black/60 dark:text-white/60 space-x-3 truncate">
										<span className="text-blue-600 dark:text-blue-400 font-medium">
											{t("levelNumber", { number: topic.level })}
										</span>
										<span className="text-emerald-600 dark:text-emerald-400 font-medium">
											{topic.itemCount.toLocaleString(locale)} {t("itemsLowercase")}
										</span>
										<span className="text-amber-600 dark:text-amber-400 font-medium">
											{topic.totalCitations.toLocaleString(locale)} {t("citationsLowercase")}
										</span>
									</div>
								</div>
							</div>
							<div className="text-right flex-shrink-0">
								<div className="text-lg font-bold text-purple-600 dark:text-purple-400">
									{topic.hIndex}
								</div>
								<div className="text-xs text-black/60 dark:text-white/60">
									H-Index
								</div>
							</div>
						</motion.div>
					))}
				</div>
			</Card>
		</motion.div>
	);
}

function TopLevelTopics({ topics, labels }: { topics: TopicStats[]; labels: TopicLabels }) {
  const locale = useLocale();
	const t = useTranslations("ui");
	return (
		<motion.div variants={itemVariants} className="space-y-4">
			<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
				<HugeiconsIcon icon={Bookmark02Icon} className="text-accent" />
				{labels.topLevelAreas}
			</h3>
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{topics.filter(topic => topic.level === 1).slice(0, 12).map((topic, index) => (
					<motion.div
						key={index}
						variants={itemVariants}
						className="relative p-4 rounded-xl bg-gradient-to-r from-black/5 to-transparent dark:from-white/5 border border-black/10 dark:border-white/10 hover:border-accent/30 transition-colors duration-300 hover:scale-[1.02] group"
					>
						<div className="flex items-center gap-3">
							<div className="flex items-center gap-2 flex-shrink-0">
								<div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${rankBadgeClass(index)}`}>
									{index + 1}
								</div>
								<div className="w-3 h-3 rounded-full bg-blue-500" />
							</div>
							<div className="flex-1 min-w-0">
								<div className="font-semibold text-black dark:text-white text-sm truncate group-hover:text-accent transition-colors">
									{topic.topic}
								</div>
								<div className="text-xs text-black/60 dark:text-white/60 space-x-3">
									<span className="text-blue-600 dark:text-blue-400 font-medium">
										{topic.itemCount.toLocaleString(locale)}
									</span>
									<span className="text-emerald-600 dark:text-emerald-400 font-medium">
										{topic.children.length} {labels.children}
									</span>
									<span className="text-purple-600 dark:text-purple-400 font-medium">
										H:{topic.hIndex}
									</span>
								</div>
							</div>
							<div className="text-right flex-shrink-0">
								<div className="text-sm font-bold text-accent">
									{topic.avgCitationsPerItem.toFixed(1)}
								</div>
								<div className="text-xs text-black/40 dark:text-white/40">
									{t("avgCitations")}
								</div>
							</div>
						</div>
					</motion.div>
				))}
			</div>
		</motion.div>
	);
}

export function ResearchTopics({ topicStats, topicOverview, topicsByYear, kind = "topics" }: ResearchTopicsProps) {
  const locale = useLocale();
	const t = useTranslations("ui");
	const labels = useTopicLabels(kind);
	const [topicsPage, setTopicsPage] = useState(1);
	const [topicsSearch, setTopicsSearch] = useState("");
	const [selectedTopicLevel, setSelectedTopicLevel] = useState<string>("all");
	const [selectedYear, setSelectedYear] = useState<string>("all");
	const [topicsSortDescriptor, setTopicsSortDescriptor] = useState<{ column: string, direction: "ascending" | "descending" }>({
		column: "itemCount",
		direction: "descending"
	});
	const rowsPerPage = 10;

	// Get available years from topicsByYear data
	const availableYears = useMemo(() => {
		if (!topicsByYear) return [];
		const years = Array.from(new Set(topicsByYear.map(t => t.year)))
			.filter(year => year && !isNaN(parseInt(year)))
			.sort((a, b) => parseInt(b) - parseInt(a));
		return years;
	}, [topicsByYear]);

	// Helper function to calculate H-Index from citation counts
	const calculateHIndex = (citationCounts: number[]): number => {
		if (!citationCounts || citationCounts.length === 0) return 0;
		
		const sortedCitations = [...citationCounts].sort((a, b) => b - a);
		let hIndex = 0;
		
		for (let i = 0; i < sortedCitations.length; i++) {
			const citations = sortedCitations[i];
			const rank = i + 1;
			
			if (citations >= rank) {
				hIndex = rank;
			} else {
				break;
			}
		}
		
		return hIndex;
	};

	// Aggregate topics by year when year filter is applied
	const yearFilteredTopics = useMemo(() => {
		if (!topicsByYear || selectedYear === "all") {
			return topicStats;
		}

		// Group topics by fullPath for the selected year, collecting citation counts
		const yearTopicsMap = new Map<string, {
			id: string;
			topic: string;
			fullPath: string;
			itemCount: number;
			totalCitations: number;
			level: number;
			parentTopic?: string;
			citationCounts: number[];
		}>();

		topicsByYear
			.filter(t => t.year === selectedYear)
			.forEach(yearTopic => {
				const existing = yearTopicsMap.get(yearTopic.id);
				if (existing) {
					existing.itemCount += yearTopic.itemCount;
					existing.totalCitations += yearTopic.totalCitations;
					// Add individual citation counts for H-index calculation
					for (let i = 0; i < yearTopic.itemCount; i++) {
						existing.citationCounts.push(Math.floor(yearTopic.totalCitations / yearTopic.itemCount));
					}
				} else {
					// Initialize citation counts array for H-index calculation
					const citationCounts: number[] = [];
					for (let i = 0; i < yearTopic.itemCount; i++) {
						citationCounts.push(Math.floor(yearTopic.totalCitations / yearTopic.itemCount));
					}
					
					yearTopicsMap.set(yearTopic.id, {
						id: yearTopic.id,
						topic: yearTopic.topic,
						fullPath: yearTopic.fullPath,
						itemCount: yearTopic.itemCount,
						totalCitations: yearTopic.totalCitations,
						level: yearTopic.level,
						parentTopic: yearTopic.parentTopic,
						citationCounts
					});
				}
			});

		// Convert to TopicStats format with calculated fields
		return Array.from(yearTopicsMap.values()).map(data => {
			const avgCitations = data.itemCount > 0 ? data.totalCitations / data.itemCount : 0;
			
			// Find original topic data to preserve children and isLeaf information
			const originalTopic = topicStats.find(t => t.id === data.id);
			
			return {
				id: data.id,
				topic: data.topic,
				level: data.level,
				parentTopic: data.parentTopic,
				fullPath: data.fullPath,
				itemCount: data.itemCount,
				totalCitations: data.totalCitations,
				avgCitationsPerItem: Number(avgCitations.toFixed(2)),
				hIndex: calculateHIndex(data.citationCounts),
				isLeaf: originalTopic?.isLeaf ?? true,
				children: originalTopic?.children ?? []
			} as TopicStats;
		}).sort((a, b) => b.itemCount - a.itemCount);
	}, [topicStats, topicsByYear, selectedYear]);

	// Topic filtering and sorting
	const filteredTopics = useMemo(() => {
		let filtered = yearFilteredTopics;

		// Filter by level
		if (selectedTopicLevel !== "all") {
			const level = parseInt(selectedTopicLevel);
			filtered = filtered.filter((topic) => topic.level === level);
		}

		// Filter by search term
		if (topicsSearch.trim()) {
			filtered = filtered.filter((topic) =>
				topic.topic.toLowerCase().includes(topicsSearch.toLowerCase()) ||
				topic.fullPath.toLowerCase().includes(topicsSearch.toLowerCase())
			);
		}

		// Apply sorting
		const sorted = [...filtered].sort((a, b) => {
			let aValue: any = a[topicsSortDescriptor.column as keyof TopicStats];
			let bValue: any = b[topicsSortDescriptor.column as keyof TopicStats];

			// Handle array sorting (for children)
			if (Array.isArray(aValue)) {
				aValue = aValue.length;
				bValue = Array.isArray(bValue) ? bValue.length : 0;
			}

			// Handle string sorting
			if (typeof aValue === "string") {
				aValue = aValue.toLowerCase();
				bValue = typeof bValue === "string" ? bValue.toLowerCase() : "";
			}

			let comparison = 0;
			if (aValue < bValue) {
				comparison = -1;
			} else if (aValue > bValue) {
				comparison = 1;
			}

			return topicsSortDescriptor.direction === "descending" ? -comparison : comparison;
		});

		return sorted;
	}, [yearFilteredTopics, topicsSearch, selectedTopicLevel, topicsSortDescriptor]);

	const paginatedTopics = useMemo(() => {
		const start = (topicsPage - 1) * rowsPerPage;
		const end = start + rowsPerPage;
		return filteredTopics.slice(start, end);
	}, [filteredTopics, topicsPage]);

	const topicsPages = Math.ceil(filteredTopics.length / rowsPerPage);

	return (
		<SectionCard title={labels.title} icon={TagsIcon}>
			<div className="space-y-8">
				{/* Topic Overview Stats */}
				<TopicOverviewTiles
					topics={yearFilteredTopics}
					topicOverview={topicOverview}
					selectedYear={selectedYear}
					labels={labels}
				/>

				{/* Charts Section */}
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
					{/* Topic Distribution by Level */}
					<LevelDistribution topicOverview={topicOverview} labels={labels} />

					{/* Top Topics by H-Index */}
					<TopTopicsByImpact topics={yearFilteredTopics} labels={labels} />
				</div>

				{/* Topic Hierarchy Visualization */}
				<TopLevelTopics topics={yearFilteredTopics} labels={labels} />

				{/* Detailed Topics Table */}
				<motion.div variants={itemVariants} className="space-y-4">
					<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
						<HugeiconsIcon icon={TagsIcon} className="text-accent" />
						{labels.all}
					</h3>
					<div className="space-y-4">
						<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
							<Input
								label={labels.search}
								value={topicsSearch}
								onChange={(e) => {
									setTopicsSearch(e.target.value);
									setTopicsPage(1);
								}}
								placeholder={labels.searchPlaceholder}
								startContent={<HugeiconsIcon icon={Search01Icon} className="text-black/40 dark:text-white/40" />}
							/>
							{topicsByYear && availableYears.length > 0 && (
								<Select
									label={t("filterByYear")}
									placeholder={t("selectYear")}
									placement="left"
									selectedKeys={[selectedYear]}
									onSelectionChange={(keys) => {
										const selected = Array.from(keys)[0] as string;
										setSelectedYear(selected || "all");
										setTopicsPage(1);
									}}
									classNames={{
										base: "flex-1 max-w-full",
										trigger: "h-full",
									}}
									items={[
										{ key: "all", name: t("allYears") },
										...availableYears.map(year => ({
											key: year,
											name: year,
										})),
									]}
								>
									{(item: any) => (
										<SelectItem key={item.key}>
											{item.name}
										</SelectItem>
									)}
								</Select>
							)}
							<Select
								label={t("filterByLevel")}
								placeholder={t("selectLevel")}
								placement="left"
								selectedKeys={[selectedTopicLevel]}
								onSelectionChange={(keys) => {
									const selected = Array.from(keys)[0] as string;
									setSelectedTopicLevel(selected || "all");
									setTopicsPage(1);
								}}
								classNames={{
									base: "flex-1 max-w-full",
									trigger: "h-full",
								}}
								items={[
									{ key: "all", name: t("allLevels") },
									...Array.from({ length: topicOverview.maxDepth }, (_, i) => ({
										key: (i + 1).toString(),
										name: t("levelNumber", { number: i + 1 }),
									})),
								]}
							>
								{(item: any) => (
									<SelectItem key={item.key}>
										{item.name}
									</SelectItem>
								)}
							</Select>
						</div>
						<Table
							color="statistics"
							aria-label={labels.table}
							sortDescriptor={topicsSortDescriptor}
							onSortChange={(descriptor: any) => setTopicsSortDescriptor(descriptor)}
						>
							<TableHeader>
								<TableColumn key="topic" allowsSorting>{labels.column}</TableColumn>
								<TableColumn key="level" allowsSorting>{t("levelColumn")}</TableColumn>
								<TableColumn key="itemCount" allowsSorting>{t("itemsColumn")}</TableColumn>
								<TableColumn key="totalCitations" allowsSorting>{t("citationsColumn")}</TableColumn>
								<TableColumn key="avgCitationsPerItem" allowsSorting>{t("avgPerItemColumn")}</TableColumn>
								<TableColumn key="hIndex" allowsSorting>H-Index</TableColumn>
								<TableColumn key="children" allowsSorting>{t("subtopicsColumn")}</TableColumn>
							</TableHeader>
							<TableBody>
								{paginatedTopics.map((topic, index) => (
									<TableRow key={index}>
										<TableCell>
											<div className="space-y-1">
												<div className="flex items-center gap-2">
													<div className={`w-2 h-2 rounded-full flex-shrink-0 ${levelClass(LEVEL_DOT_CLASSES, topic.level)}`} />
													<span className="font-medium truncate">
														{topic.topic}
													</span>
												</div>
												<div className="text-xs text-black/60 dark:text-white/60 truncate">
													{topic.fullPath}
												</div>
												{topic.parentTopic && (
													<div className="text-xs text-black/40 dark:text-white/40">
														{t("parent")}: {topic.parentTopic}
													</div>
												)}
											</div>
										</TableCell>
										<TableCell>
											<span className={`px-2 py-1 rounded-full text-xs font-medium ${levelClass(LEVEL_BADGE_CLASSES, topic.level)}`}>
												{t("levelNumber", { number: topic.level })}
											</span>
										</TableCell>
										<TableCell>
											<span className="font-bold text-accent">
												{topic.itemCount.toLocaleString(locale)}
											</span>
										</TableCell>
										<TableCell>
											<span className="font-bold text-success">
												{topic.totalCitations.toLocaleString(locale)}
											</span>
										</TableCell>
										<TableCell>
											<span className="font-bold text-tertiary">
												{topic.avgCitationsPerItem.toFixed(1)}
											</span>
										</TableCell>
										<TableCell>
											<span className="font-bold text-purple-600 dark:text-purple-400">
												{topic.hIndex}
											</span>
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-1">
												<span className="font-bold text-emerald-600 dark:text-emerald-400">
													{topic.children.length}
												</span>
												{topic.isLeaf && (
													<span className="text-xs text-black/40 dark:text-white/40">({t("leaf")})</span>
												)}
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
						{topicsPages > 1 && (
							<div className="flex justify-center">
								<Pagination
									total={topicsPages}
									page={topicsPage}
									onChange={setTopicsPage}
									showControls
									size="sm"
								/>
							</div>
						)}
					</div>
				</motion.div>
			</div>
		</SectionCard>
	);
}
