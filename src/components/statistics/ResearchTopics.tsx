import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Bookmark02Icon, ChartIncreaseIcon, Layers01Icon, Search01Icon, TagsIcon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import {
	BarChart,
	Bar,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	ResponsiveContainer,
} from "recharts";
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from "@/components/nextui/Table";
import { Input } from "@/components/nextui/Input";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Pagination } from "@/components/nextui/Pagination";
import { Card } from "@/components/nextui/Card";
import { SectionCard } from "./SectionCard";
import { TopicStats, TopicOverview, TopicYearStats } from "./types";

type ResearchTopicsProps = {
	topicStats: TopicStats[];
	topicOverview: TopicOverview;
	topicsByYear?: TopicYearStats[];
};

const itemVariants = {
	hidden: { y: 20, opacity: 0 },
	show: { y: 0, opacity: 1 },
};

export function ResearchTopics({ topicStats, topicOverview, topicsByYear }: ResearchTopicsProps) {
	const t = useTranslations("ui");
	const { resolvedTheme: theme } = useTheme();
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
		<SectionCard title={t("researchTopics")} icon={TagsIcon}>
			<div className="space-y-8">
				{/* Topic Overview Stats */}
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
					<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20">
						<div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-2">
							{yearFilteredTopics.length.toLocaleString()}
						</div>
						<div className="text-sm font-medium text-black/60 dark:text-white/60">
							{t("totalTopics")}
						</div>
						<div className="text-xs text-black/40 dark:text-white/40 mt-1">
							{selectedYear !== "all" ? t("inYear", { year: selectedYear }) : t("allHierarchicalLevels")}
						</div>
					</motion.div>
					<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20">
						<div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 mb-2">
							{yearFilteredTopics.filter(t => t.level === 1).length.toLocaleString()}
						</div>
						<div className="text-sm font-medium text-black/60 dark:text-white/60">
							{t("topLevelTopics")}
						</div>
						<div className="text-xs text-black/40 dark:text-white/40 mt-1">
							{selectedYear !== "all" ? t("inYear", { year: selectedYear }) : t("mainResearchAreas")}
						</div>
					</motion.div>
					<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20">
						<div className="text-3xl font-bold text-amber-600 dark:text-amber-400 mb-2">
							{selectedYear !== "all" ? Math.max(...yearFilteredTopics.map(t => t.level), 0) : topicOverview.maxDepth}
						</div>
						<div className="text-sm font-medium text-black/60 dark:text-white/60">
							{t("maxDepth")}
						</div>
						<div className="text-xs text-black/40 dark:text-white/40 mt-1">
							{selectedYear !== "all" ? t("inYear", { year: selectedYear }) : t("hierarchicalLevels")}
						</div>
					</motion.div>
					<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20">
						<div className="text-3xl font-bold text-purple-600 dark:text-purple-400 mb-2">
							{selectedYear !== "all" 
								? (yearFilteredTopics.length > 0 
									? (yearFilteredTopics.reduce((sum, t) => sum + t.itemCount, 0) / yearFilteredTopics.length).toFixed(1)
									: "0")
								: topicOverview.avgItemsPerTopic}
						</div>
						<div className="text-sm font-medium text-black/60 dark:text-white/60">
							{t("avgItemsPerTopic")}
						</div>
						<div className="text-xs text-black/40 dark:text-white/40 mt-1">
							{selectedYear !== "all" ? t("inYear", { year: selectedYear }) : t("publicationsPerTopic")}
						</div>
					</motion.div>
				</div>

				{/* Charts Section */}
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
					{/* Topic Distribution by Level */}
					<motion.div variants={itemVariants} className="space-y-4">
						<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
							<HugeiconsIcon icon={Layers01Icon} className="text-accent" />
							{t("topicDistributionByLevel")}
						</h3>
						<Card color="card" className="p-6">
							<div className="h-96">
								<ResponsiveContainer width="100%" height="100%">
									<BarChart
										data={topicOverview.topicDistribution}
										margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
									>
										<CartesianGrid strokeDasharray="3 3" className="stroke-black/10 dark:stroke-white/10" />
										<XAxis
											dataKey="level"
											className="text-black/60 dark:text-white/60"
											tick={{ fontSize: 12 }}
											axisLine={false}
											tickFormatter={(value) => `Level ${value}`}
										/>
										<YAxis
											className="text-black/60 dark:text-white/60"
											tick={{ fontSize: 12 }}
											axisLine={false}
											tickFormatter={(value) => value.toLocaleString()}
										/>
										<Tooltip
											contentStyle={{
												backgroundColor: theme === "dark" ? "#1a1a1a" : "#ffffff",
												border: `1px solid ${theme === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"}`,
												borderRadius: "12px",
												boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
												padding: "12px",
											}}
											labelStyle={{ color: theme === "dark" ? "#ffffff" : "#000000", fontWeight: "500" }}
											itemStyle={{ color: theme === "dark" ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.8)" }}
											formatter={(value: number, name: string, props: any) => [
												`${value.toLocaleString()} ${t("topicsLowercase")} (${props.payload.percentage}%)`,
												t("levelNumber", { number: props.payload.level })
											]}
										/>
										<Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} />
									</BarChart>
								</ResponsiveContainer>
							</div>
						</Card>
					</motion.div>

					{/* Top Topics by H-Index */}
					<motion.div variants={itemVariants} className="space-y-4">
						<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
							<HugeiconsIcon icon={ChartIncreaseIcon} className="text-accent" />
							{t("topTopicsByImpact")}
						</h3>
						<Card color="card" className="p-6">
							<div className="space-y-4 h-96 overflow-y-auto">
								{yearFilteredTopics.slice(0, 20).map((topic, index) => (
									<motion.div
										key={index}
										variants={itemVariants}
										className="flex items-center justify-between p-4 rounded-xl bg-gradient-to-r from-black/5 to-transparent dark:from-white/5 border border-black/10 dark:border-white/10 hover:border-accent/30 transition-all duration-300"
									>
										<div className="flex items-center gap-3 flex-1 min-w-0">
											<div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${index < 3
													? "bg-gradient-to-r from-amber-400 to-amber-600 text-white"
													: "bg-black/10 dark:bg-white/10 text-black/60 dark:text-white/60"
												}`}>
												{index + 1}
											</div>
											<div className="flex items-center gap-2">
												<div className={`w-2 h-2 rounded-full ${topic.level === 1
														? "bg-blue-500"
														: topic.level === 2
															? "bg-emerald-500"
															: topic.level === 3
																? "bg-amber-500"
																: "bg-purple-500"
													}`} />
											</div>
											<div className="flex-1 min-w-0">
												<div className="font-semibold text-black dark:text-white text-sm truncate">
													{topic.topic}
												</div>
												<div className="text-xs text-black/60 dark:text-white/60 space-x-2 truncate">
													<span className="text-blue-600 dark:text-blue-400 font-medium">
														{t("levelNumber", { number: topic.level })}
													</span>
													<span>•</span>
													<span className="text-emerald-600 dark:text-emerald-400 font-medium">
														{topic.itemCount.toLocaleString()} {t("itemsLowercase")}
													</span>
													<span>•</span>
													<span className="text-amber-600 dark:text-amber-400 font-medium">
														{topic.totalCitations.toLocaleString()} {t("citationsLowercase")}
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
				</div>

				{/* Topic Hierarchy Visualization */}
				<motion.div variants={itemVariants} className="space-y-4">
					<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
						<HugeiconsIcon icon={Bookmark02Icon} className="text-accent" />
						{t("topLevelResearchAreas")}
					</h3>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
						{yearFilteredTopics.filter(topic => topic.level === 1).slice(0, 12).map((topic, index) => (
							<motion.div
								key={index}
								variants={itemVariants}
								className="relative p-4 rounded-xl bg-gradient-to-r from-black/5 to-transparent dark:from-white/5 border border-black/10 dark:border-white/10 hover:border-accent/30 transition-all duration-300 hover:scale-[1.02] group"
							>
								<div className="flex items-center gap-3">
									<div className="flex items-center gap-2 flex-shrink-0">
										<div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${index < 3
												? "bg-gradient-to-r from-amber-400 to-amber-600 text-white"
												: "bg-black/10 dark:bg-white/10 text-black/60 dark:text-white/60"
											}`}>
											{index + 1}
										</div>
										<div className="w-3 h-3 rounded-full bg-blue-500" />
									</div>
									<div className="flex-1 min-w-0">
										<div className="font-semibold text-black dark:text-white text-sm truncate group-hover:text-accent transition-colors">
											{topic.topic}
										</div>
										<div className="text-xs text-black/60 dark:text-white/60 space-x-2">
											<span className="text-blue-600 dark:text-blue-400 font-medium">
												{topic.itemCount.toLocaleString()}
											</span>
											<span>•</span>
											<span className="text-emerald-600 dark:text-emerald-400 font-medium">
												{topic.children.length} {t("subtopicsLowercase")}
											</span>
											<span>•</span>
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

				{/* Detailed Topics Table */}
				<motion.div variants={itemVariants} className="space-y-4">
					<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
						<HugeiconsIcon icon={TagsIcon} className="text-accent" />
						{t("allResearchTopics")}
					</h3>
					<div className="space-y-4">
						<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
							<Input
								label={t("searchTopics")}
								value={topicsSearch}
								onChange={(e) => {
									setTopicsSearch(e.target.value);
									setTopicsPage(1);
								}}
								placeholder={t("searchByTopicNameOrPath")}
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
							aria-label={t("topicsStatisticsTable")}
							sortDescriptor={topicsSortDescriptor}
							onSortChange={(descriptor: any) => setTopicsSortDescriptor(descriptor)}
						>
							<TableHeader>
								<TableColumn key="topic" allowsSorting>{t("topicColumn")}</TableColumn>
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
													<div className={`w-2 h-2 rounded-full flex-shrink-0 ${topic.level === 1
															? "bg-blue-500"
															: topic.level === 2
																? "bg-emerald-500"
																: topic.level === 3
																	? "bg-amber-500"
																	: "bg-purple-500"
														}`} />
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
											<span className={`px-2 py-1 rounded-full text-xs font-medium ${topic.level === 1
													? "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200"
													: topic.level === 2
														? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200"
														: topic.level === 3
															? "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200"
															: "bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-200"
												}`}>
												{t("levelNumber", { number: topic.level })}
											</span>
										</TableCell>
										<TableCell>
											<span className="font-bold text-accent">
												{topic.itemCount.toLocaleString()}
											</span>
										</TableCell>
										<TableCell>
											<span className="font-bold text-success">
												{topic.totalCitations.toLocaleString()}
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
