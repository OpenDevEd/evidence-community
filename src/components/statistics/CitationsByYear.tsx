import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { BarChartIcon, Building02Icon, Cancel01Icon, FilterIcon, Folder01Icon, QuoteUpIcon } from "@hugeicons/core-free-icons";
import { useMemo, useState, memo, Fragment } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import {
	LineChart,
	Line,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	ResponsiveContainer,
	Legend,
} from "recharts";
import { Button } from "@/components/nextui/Button";
import { Card } from "@/components/nextui/Card";
import { Autocomplete } from "@/components/nextui/Autocomplete";
import { AutocompleteItem } from "@nextui-org/react";
import { Key } from "react";
import { SectionCard } from "./SectionCard";
import { CountryFlag } from "./CountryFlag";
import { CitationYearStats, InstitutionYearStats, TopicYearStats } from "./types";
import { COUNTRIES } from "@/constants/misc";

type CitationsByYearProps = {
	citationsByYear: CitationYearStats[];
	institutionsByYear: InstitutionYearStats[];
	topicsByYear: TopicYearStats[];
};

const itemVariants = {
	hidden: { y: 20, opacity: 0 },
	show: { y: 0, opacity: 1 },
};

/** Rows for one institution or topic, summed per year into the chart's shape. */
function perYear(rows: readonly { year: string; totalCitations: number; itemCount: number }[]) {
	const years = new Map<string, { totalCitations: number; itemCount: number }>();
	for (const row of rows) {
		const sum = years.get(row.year) ?? { totalCitations: 0, itemCount: 0 };
		years.set(row.year, { totalCitations: sum.totalCitations + row.totalCitations, itemCount: sum.itemCount + row.itemCount });
	}
	return Array.from(years, ([year, sum]) => ({
		year,
		...sum,
		avgCitationsPerItem: sum.itemCount > 0 ? sum.totalCitations / sum.itemCount : 0,
	}));
}

export function CitationsByYear({ citationsByYear, institutionsByYear, topicsByYear }: CitationsByYearProps) {
	const t = useTranslations("ui");
	const { resolvedTheme: theme } = useTheme();
	const [selectedInstitution, setSelectedInstitution] = useState<string>("all");
	const [selectedTopic, setSelectedTopic] = useState<string>("all");
	
	// Get all institutions with their counts (don't limit here)
	const allInstitutions = useMemo(() => {
		const institutionCounts = new Map<string, number>();
		institutionsByYear.forEach(item => {
			const current = institutionCounts.get(item.institution) || 0;
			institutionCounts.set(item.institution, current + item.itemCount);
		});
		
		return Array.from(institutionCounts.entries())
			.map(([name, count]) => ({ value: name, label: `${name} (${count.toLocaleString()})`, count }))
			.sort((a, b) => b.count - a.count);
	}, [institutionsByYear]);

	// Get all topics with their counts (don't limit here)
	const allTopics = useMemo(() => {
		const topicCounts = new Map<string, { topic: string; level: number; count: number }>();
		topicsByYear.forEach(item => {
			const current = topicCounts.get(item.id);
			topicCounts.set(item.id, { topic: item.topic, level: item.level, count: (current?.count ?? 0) + item.itemCount });
		});
		
		return Array.from(topicCounts.entries())
			.map(([id, { topic, level, count }]) => ({ 
				value: id, 
				topic,
				level,
				label: `${topic} (${count.toLocaleString()})`, 
				count 
			}))
			.sort((a, b) => b.count - a.count);
	}, [topicsByYear]);

	// Filter institutions based on search, then limit to 200
	const [institutionSearchTerm, setInstitutionSearchTerm] = useState("");
	const [topicSearchTerm, setTopicSearchTerm] = useState("");

	const filteredInstitutions = useMemo(() => {
		let filtered = allInstitutions;
		
		if (institutionSearchTerm.trim()) {
			const searchLower = institutionSearchTerm.toLowerCase();
			filtered = allInstitutions.filter(inst => 
				inst.value.toLowerCase().includes(searchLower)
			);
		}
		
		return filtered.slice(0, 200); // Limit to 200 after filtering
	}, [allInstitutions, institutionSearchTerm]);

	// Filter topics based on search, then limit to 200
	const filteredTopics = useMemo(() => {
		let filtered = allTopics;
		
		if (topicSearchTerm.trim()) {
			const searchLower = topicSearchTerm.toLowerCase();
			filtered = allTopics.filter(topic => 
				topic.value.toLowerCase().includes(searchLower) ||
				topic.label.toLowerCase().includes(searchLower)
			);
		}
		
		return filtered.slice(0, 200); // Limit to 200 after filtering
	}, [allTopics, topicSearchTerm]);

	// Process chart data based on filters
	const chartData = useMemo(() => {
		let data = citationsByYear;
		
		if (selectedInstitution !== "all") {
			data = perYear(institutionsByYear.filter(item => item.institution === selectedInstitution));
		} else if (selectedTopic !== "all") {
			data = perYear(topicsByYear.filter(item => item.id === selectedTopic));
		}
		
		return data
			.filter(item => item.year && !isNaN(parseInt(item.year)))
			.sort((a, b) => parseInt(a.year) - parseInt(b.year));
	}, [citationsByYear, institutionsByYear, topicsByYear, selectedInstitution, selectedTopic]);

	// Calculate stats
	const stats = useMemo(() => {
		const totalCitations = chartData.reduce((sum, item) => sum + item.totalCitations, 0);
		const totalItems = chartData.reduce((sum, item) => sum + item.itemCount, 0);
		const avgCitationsPerItem = totalItems > 0 ? totalCitations / totalItems : 0;

		return {
			totalCitations,
			totalItems,
			avgCitationsPerItem: Number(avgCitationsPerItem.toFixed(2)),
			yearsCovered: chartData.length,
		};
	}, [chartData]);

	const handleInstitutionChange = (key: Key | null) => {
		setSelectedInstitution(key as string || "all");
		if (key !== "all") setSelectedTopic("all");
	};

	const handleTopicChange = (key: Key | null) => {
		setSelectedTopic(key as string || "all");
		if (key !== "all") setSelectedInstitution("all");
	};

	const clearFilters = () => {
		setSelectedInstitution("all");
		setSelectedTopic("all");
	};

	const hasActiveFilters = selectedInstitution !== "all" || selectedTopic !== "all";

	return (
		<SectionCard title={t("citationsByYear")} icon={QuoteUpIcon}>
			<div className="space-y-8">
				{/* Filter Controls */}
				<motion.div variants={itemVariants} className="space-y-4">
					<div className="flex items-center justify-between">
						<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
							<HugeiconsIcon icon={FilterIcon} className="text-accent" />
							{t("filterOptions")}
						</h3>
						{hasActiveFilters && (
							<Button
								size="sm"
								variant="flat"
								color="default"
								onPress={clearFilters}
								startContent={<HugeiconsIcon icon={Cancel01Icon} />}
							>
								{t("clearFilters")}
							</Button>
						)}
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{/* Institution Filter */}
						<Autocomplete
							label={t("filterByInstitution")}
							placeholder={t("selectInstitution")}
							selectedKey={selectedInstitution}
							onSelectionChange={handleInstitutionChange}
							onInputChange={setInstitutionSearchTerm}
							itemHeight={48}
							inputProps={{
								classNames: {
									inputWrapper:
										"bg-card_light dark:bg-card border-small border-black/10 dark:border-white/10 rounded-2xl",
									input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base lg:text-small",
								},
							}}
							className="flex-1 max-w-full"
						>
							<Fragment>
								<AutocompleteItem 
									key="all"
									startContent={<HugeiconsIcon icon={Building02Icon} className="text-black/40 dark:text-white/40" />}
								>
									{t("allInstitutions")}
								</AutocompleteItem>
								{filteredInstitutions.map((institution) => {
									const institutionData = institutionsByYear.find(inst => inst.institution === institution.value);
									const countryCode = institutionData?.countryCode;
									const countryName = countryCode ? COUNTRIES[countryCode] : undefined;
									
									return (
										<AutocompleteItem 
											key={institution.value}
											startContent={
												<div className="flex items-center gap-2">
													{countryCode && (
														<CountryFlag countryCode={countryCode} className="w-5 h-3" />
													)}
													<HugeiconsIcon icon={Building02Icon} className="text-black/40 dark:text-white/40" />
												</div>
											}
											description={countryName ? `${countryName}, ${institution.count.toLocaleString()} items` : `${institution.count.toLocaleString()} items`}
										>
											{institution.value}
										</AutocompleteItem>
									);
								})}
							</Fragment>
						</Autocomplete>

						{/* Topic Filter */}
						<Autocomplete
							label={t("filterByTopic")}
							placeholder={t("selectTopic")}
							selectedKey={selectedTopic}
							onSelectionChange={handleTopicChange}
							onInputChange={setTopicSearchTerm}
							itemHeight={48}
							inputProps={{
								classNames: {
									inputWrapper:
										"bg-card_light dark:bg-card border-small border-black/10 dark:border-white/10 rounded-2xl",
									input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base lg:text-small",
								},
							}}
							className="flex-1 max-w-full"
						>
							<Fragment>
								<AutocompleteItem 
									key="all"
									startContent={<HugeiconsIcon icon={Folder01Icon} className="text-black/40 dark:text-white/40" />}
								>
									{t("allTopics")}
								</AutocompleteItem>
								{filteredTopics.map((topic) => {
									const { level, topic: displayName } = topic;
									
									return (
										<AutocompleteItem 
											key={topic.value}
											startContent={
												<div className="flex items-center gap-2">
													<HugeiconsIcon icon={Folder01Icon} className="text-black/40 dark:text-white/40" />
													{level > 1 && (
														<span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
															L{level}
														</span>
													)}
												</div>
											}
											description={`${topic.count.toLocaleString()} items`}
										>
											{displayName}
										</AutocompleteItem>
									);
								})}
							</Fragment>
						</Autocomplete>
					</div>
				</motion.div>

				{/* Stats */}
				<motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-4 gap-6">
					<div className="text-center p-6 rounded-2xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20">
						<div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-2">
							{stats.totalCitations.toLocaleString()}
						</div>
						<div className="text-sm font-medium text-black/60 dark:text-white/60">
							{t("totalCitations")}
						</div>
					</div>
					<div className="text-center p-6 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20">
						<div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 mb-2">
							{stats.totalItems.toLocaleString()}
						</div>
						<div className="text-sm font-medium text-black/60 dark:text-white/60">
							{t("totalItems")}
						</div>
					</div>
					<div className="text-center p-6 rounded-2xl bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20">
						<div className="text-3xl font-bold text-amber-600 dark:text-amber-400 mb-2">
							{stats.avgCitationsPerItem}
						</div>
						<div className="text-sm font-medium text-black/60 dark:text-white/60">
							{t("avgCitationsPerItem")}
						</div>
					</div>
					<div className="text-center p-6 rounded-2xl bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20">
						<div className="text-3xl font-bold text-purple-600 dark:text-purple-400 mb-2">
							{stats.yearsCovered}
						</div>
						<div className="text-sm font-medium text-black/60 dark:text-white/60">
							{t("yearsCovered")}
						</div>
					</div>
				</motion.div>

				{/* Chart */}
				<motion.div variants={itemVariants} className="space-y-4">
					<h3 className="text-lg font-semibold text-black dark:text-white">
						{t("citationTrendsOverTime")}
					</h3>
					<Card color="card" className="p-6">
						<div className="h-96">
							<ResponsiveContainer width="100%" height="100%">
								<LineChart
									data={chartData}
									margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
								>
									<CartesianGrid strokeDasharray="3 3" className="stroke-black/10 dark:stroke-white/10" />
									<XAxis
										dataKey="year"
										className="text-black/60 dark:text-white/60"
										tick={{ fontSize: 12 }}
										axisLine={false}
									/>
									<YAxis
										yAxisId="citations"
										orientation="left"
										className="text-black/60 dark:text-white/60"
										tick={{ fontSize: 12 }}
										axisLine={false}
										tickFormatter={(value) => value.toLocaleString()}
									/>
									<YAxis
										yAxisId="avg"
										orientation="right"
										className="text-black/60 dark:text-white/60"
										tick={{ fontSize: 12 }}
										axisLine={false}
										tickFormatter={(value) => value.toFixed(1)}
									/>
									<YAxis
										yAxisId="items"
										orientation="right"
										className="text-black/60 dark:text-white/60"
										tick={{ fontSize: 12 }}
										axisLine={false}
										tickFormatter={(value) => value.toLocaleString()}
									/>
									<Tooltip
										contentStyle={{
											backgroundColor: "transparent",
											border: `1px solid ${theme === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"}`,
											borderRadius: "16px",
											boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
											padding: "16px",
											minWidth: "200px",
										}}
										labelStyle={{ display: "none" }}
										itemStyle={{ display: "none" }}
										content={({ active, payload, label }) => {
											if (!active || !payload || !payload.length) return null;
											
											const data = payload[0].payload;
											const totalCitations = data.totalCitations;
											const avgCitations = data.avgCitationsPerItem;
											const itemCount = data.itemCount;
											
											return (
												<div className="bg-card_light dark:bg-card border border-black/10 dark:border-white/10 rounded-2xl shadow-lg p-4 min-w-[200px] space-y-3">
													{/* Header */}
													<div className="flex items-center gap-2 pb-2 border-b border-black/10 dark:border-white/10">
														<HugeiconsIcon icon={BarChartIcon} className="text-accent w-4 h-4" />
														<span className="font-semibold text-black dark:text-white">
															{t("year")} {label}
														</span>
													</div>
													
													{/* Stats */}
													<div className="space-y-2">
														{/* Total Citations */}
														<div className="flex items-center justify-between gap-3">
															<div className="flex items-center gap-2">
																<div className="w-3 h-3 rounded-full bg-blue-500"></div>
																<span className="text-sm font-medium text-black/80 dark:text-white/80">
																	{t("totalCitations")}
																</span>
															</div>
															<span className="text-sm font-bold text-blue-600 dark:text-blue-400">
																{totalCitations?.toLocaleString() || 0}
															</span>
														</div>
														
														{/* Average Citations */}
														<div className="flex items-center justify-between gap-3">
															<div className="flex items-center gap-2">
																<div className="w-3 h-3 rounded-full bg-yellow-500"></div>
																<span className="text-sm font-medium text-black/80 dark:text-white/80">
																	{t("avgCitationsPerItem")}
																</span>
															</div>
															<span className="text-sm font-bold text-yellow-600 dark:text-yellow-400">
																{avgCitations?.toFixed(2) || "0.00"}
															</span>
														</div>
														
														{/* Total Items */}
														<div className="flex items-center justify-between gap-3">
															<div className="flex items-center gap-2">
																<div className="w-3 h-3 rounded-full bg-emerald-500"></div>
																<span className="text-sm font-medium text-black/80 dark:text-white/80">
																	{t("totalItems")}
																</span>
															</div>
															<span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
																{itemCount?.toLocaleString() || 0}
															</span>
														</div>
													</div>
												</div>
											);
										}}
									/>
									<Legend />
									<Line
										yAxisId="citations"
										type="monotone"
										dataKey="totalCitations"
										stroke="#3B82F6"
										strokeWidth={3}
										dot={{ fill: "#3B82F6", strokeWidth: 2, r: 4 }}
										activeDot={{ r: 6, stroke: "#3B82F6", strokeWidth: 2 }}
										name={t("totalCitations")}
									/>
									<Line
										yAxisId="avg"
										type="monotone"
										dataKey="avgCitationsPerItem"
										stroke="#F59E0B"
										strokeWidth={3}
										dot={{ fill: "#F59E0B", strokeWidth: 2, r: 4 }}
										activeDot={{ r: 6, stroke: "#F59E0B", strokeWidth: 2 }}
										name={t("avgCitationsPerItem")}
									/>
									<Line
										yAxisId="items"
										type="monotone"
										dataKey="itemCount"
										stroke="#10B981"
										strokeWidth={3}
										dot={{ fill: "#10B981", strokeWidth: 2, r: 4 }}
										activeDot={{ r: 6, stroke: "#10B981", strokeWidth: 2 }}
										name={t("totalItems")}
									/>
								</LineChart>
							</ResponsiveContainer>
						</div>
					</Card>
				</motion.div>
			</div>
		</SectionCard>
	);
}

export default memo(CitationsByYear);
