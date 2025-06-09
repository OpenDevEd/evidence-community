import { useMemo, useState, Fragment, useCallback, memo } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { BsBarChart, BsFilter, BsX, BsBuilding, BsFolder } from "react-icons/bs";
import { useDebounce } from "@/hooks/useDebounce";
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

export function CitationsByYear({ citationsByYear, institutionsByYear, topicsByYear }: CitationsByYearProps) {
	const t = useTranslations("ui");
	const { resolvedTheme: theme } = useTheme();
	const [selectedInstitution, setSelectedInstitution] = useState<string>("all");
	const [selectedTopic, setSelectedTopic] = useState<string>("all");
	const [isFiltering, setIsFiltering] = useState(false);
	const [institutionSearchTerm, setInstitutionSearchTerm] = useState<string>("");
	const [topicSearchTerm, setTopicSearchTerm] = useState<string>("");

	// Pre-compute institution aggregations for better performance
	const institutionAggregations = useMemo(() => {
		const institutionCounts = new Map<string, number>();
		const institutionByYearMap = new Map<string, Map<string, { totalCitations: number; itemCount: number }>>();
		
		institutionsByYear.forEach(item => {
			// Count totals
			const current = institutionCounts.get(item.institution) || 0;
			institutionCounts.set(item.institution, current + item.itemCount);
			
			// Organize by institution -> year
			if (!institutionByYearMap.has(item.institution)) {
				institutionByYearMap.set(item.institution, new Map());
			}
			const yearMap = institutionByYearMap.get(item.institution)!;
			const existing = yearMap.get(item.year) || { totalCitations: 0, itemCount: 0 };
			yearMap.set(item.year, {
				totalCitations: existing.totalCitations + item.totalCitations,
				itemCount: existing.itemCount + item.itemCount
			});
		});
		
		return { institutionCounts, institutionByYearMap };
	}, [institutionsByYear]);

	// Pre-compute topic aggregations for better performance
	const topicAggregations = useMemo(() => {
		const topicCounts = new Map<string, number>();
		const topicByYearMap = new Map<string, Map<string, { totalCitations: number; itemCount: number }>>();
		
		topicsByYear.forEach(item => {
			// Count totals
			const current = topicCounts.get(item.fullPath) || 0;
			topicCounts.set(item.fullPath, current + item.itemCount);
			
			// Organize by topic -> year
			if (!topicByYearMap.has(item.fullPath)) {
				topicByYearMap.set(item.fullPath, new Map());
			}
			const yearMap = topicByYearMap.get(item.fullPath)!;
			const existing = yearMap.get(item.year) || { totalCitations: 0, itemCount: 0 };
			yearMap.set(item.year, {
				totalCitations: existing.totalCitations + item.totalCitations,
				itemCount: existing.itemCount + item.itemCount
			});
		});
		
		return { topicCounts, topicByYearMap };
	}, [topicsByYear]);

	// Get all institutions and topics for searching
	const allInstitutionsData = useMemo(() => {
		return Array.from(institutionAggregations.institutionCounts.entries())
			.map(([name, count]) => ({ value: name, label: `${name} (${count.toLocaleString()})`, count }));
	}, [institutionAggregations.institutionCounts]);

	const allTopicsData = useMemo(() => {
		return Array.from(topicAggregations.topicCounts.entries())
			.map(([path, count]) => ({ 
				value: path, 
				label: `${path.split('/').pop() || path} (${count.toLocaleString()})`, 
				count 
			}));
	}, [topicAggregations.topicCounts]);

	// Filter and limit institutions based on search term
	const filteredInstitutions = useMemo(() => {
		let filtered = allInstitutionsData;
		
		if (institutionSearchTerm.trim()) {
			const searchLower = institutionSearchTerm.toLowerCase();
			filtered = allInstitutionsData.filter(inst => 
				inst.value.toLowerCase().includes(searchLower)
			);
		}
		
		// Sort by count (descending) and limit to top 200
		return filtered
			.sort((a, b) => b.count - a.count)
			.slice(0, 200);
	}, [allInstitutionsData, institutionSearchTerm]);

	// Filter and limit topics based on search term
	const filteredTopics = useMemo(() => {
		let filtered = allTopicsData;
		
		if (topicSearchTerm.trim()) {
			const searchLower = topicSearchTerm.toLowerCase();
			filtered = allTopicsData.filter(topic => 
				topic.value.toLowerCase().includes(searchLower) ||
				topic.label.toLowerCase().includes(searchLower)
			);
		}
		
		// Sort by count (descending) and limit to top 200
		return filtered
			.sort((a, b) => b.count - a.count)
			.slice(0, 200);
	}, [allTopicsData, topicSearchTerm]);

	// Debounced filter handlers for better performance
	const [debouncedSetInstitution] = useDebounce((institution: string) => {
		setSelectedInstitution(institution);
		setIsFiltering(false);
	}, 300);

	const [debouncedSetTopic] = useDebounce((topic: string) => {
		setSelectedTopic(topic);
		setIsFiltering(false);
	}, 300);

	const handleInstitutionChange = useCallback((key: Key | null) => {
		const selected = key as string;
		setIsFiltering(true);
		debouncedSetInstitution(selected || "all");
		if (selected !== "all") setSelectedTopic("all");
	}, [debouncedSetInstitution]);

	const handleTopicChange = useCallback((key: Key | null) => {
		const selected = key as string;
		setIsFiltering(true);
		debouncedSetTopic(selected || "all");
		if (selected !== "all") setSelectedInstitution("all");
	}, [debouncedSetTopic]);

	// Process data for the chart based on selected filters - optimized with pre-computed data
	const chartData = useMemo(() => {
		if (selectedInstitution !== "all") {
			// Use pre-computed institution data
			const yearMap = institutionAggregations.institutionByYearMap.get(selectedInstitution);
			if (!yearMap) return [];
			
			return Array.from(yearMap.entries()).map(([year, data]) => ({
				year,
				totalCitations: data.totalCitations,
				itemCount: data.itemCount,
				avgCitationsPerItem: data.itemCount > 0 
					? Number((data.totalCitations / data.itemCount).toFixed(2))
					: 0
			})).filter(item => item.year && !isNaN(parseInt(item.year)))
			.sort((a, b) => parseInt(a.year) - parseInt(b.year));
		}
		
		if (selectedTopic !== "all") {
			// Use pre-computed topic data
			const yearMap = topicAggregations.topicByYearMap.get(selectedTopic);
			if (!yearMap) return [];
			
			return Array.from(yearMap.entries()).map(([year, data]) => ({
				year,
				totalCitations: data.totalCitations,
				itemCount: data.itemCount,
				avgCitationsPerItem: data.itemCount > 0 
					? Number((data.totalCitations / data.itemCount).toFixed(2))
					: 0
			})).filter(item => item.year && !isNaN(parseInt(item.year)))
			.sort((a, b) => parseInt(a.year) - parseInt(b.year));
		}
		
		// Use the original unfiltered data
		return citationsByYear
			.filter(item => item.year && item.year !== '' && !isNaN(parseInt(item.year)))
			.sort((a, b) => parseInt(a.year) - parseInt(b.year));
	}, [citationsByYear, institutionAggregations.institutionByYearMap, topicAggregations.topicByYearMap, selectedInstitution, selectedTopic]);

	// Calculate overall stats for the filtered data
	const overallStats = useMemo(() => {
		const totalCitations = chartData.reduce((sum, item) => sum + item.totalCitations, 0);
		const totalItems = chartData.reduce((sum, item) => sum + item.itemCount, 0);
		const avgCitationsPerItem = totalItems > 0 ? Number((totalCitations / totalItems).toFixed(2)) : 0;

		return {
			totalCitations,
			totalItems,
			avgCitationsPerItem,
			yearsCovered: chartData.length,
		};
	}, [chartData]);

	const clearFilters = () => {
		setSelectedInstitution("all");
		setSelectedTopic("all");
	};

	const hasActiveFilters = selectedInstitution !== "all" || selectedTopic !== "all";

	return (
		<SectionCard title={t("citationsByYear")} icon={BsBarChart}>
			<div className="space-y-8">
				{/* Filter Controls */}
				<motion.div variants={itemVariants} className="space-y-4">
					<div className="flex items-center justify-between">
						<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
							<BsFilter className="text-accent" />
							{t("filterOptions")}
						</h3>
						{hasActiveFilters && (
							<Button
								size="sm"
								variant="flat"
								color="default"
								onPress={clearFilters}
								startContent={<BsX />}
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
							onInputChange={(value) => setInstitutionSearchTerm(value)}
							inputProps={{
								classNames: {
									inputWrapper:
										"bg-white dark:bg-card border-small border-black/10 dark:border-white/10 rounded-2xl",
									input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base lg:text-small",
								},
							}}
							className="flex-1 max-w-full"
							isVirtualized={true}
							itemHeight={64}
						>
							{[
								<AutocompleteItem 
									key="all"
									startContent={<BsBuilding className="text-black/40 dark:text-white/40" />}
								>
									{t("allInstitutions")}
								</AutocompleteItem>,
								...filteredInstitutions.map((institution) => {
								// Find the institution data to get country code
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
												<BsBuilding className="text-black/40 dark:text-white/40" />
											</div>
										}
										description={countryName ? `${countryName} • ${institution.count.toLocaleString()} items` : `${institution.count.toLocaleString()} items`}
										textValue={`${institution.value} ${countryName || ''}`}
									>
										<div className="flex flex-col">
											<span className="font-medium">{institution.value}</span>
										</div>
									</AutocompleteItem>
								);
							})
							]}
						</Autocomplete>

						{/* Topic Filter */}
						<Autocomplete
							label={t("filterByTopic")}
							placeholder={t("selectTopic")}
							selectedKey={selectedTopic}
							onSelectionChange={handleTopicChange}
							onInputChange={(value) => setTopicSearchTerm(value)}
							inputProps={{
								classNames: {
									inputWrapper:
										"bg-white dark:bg-card border-small border-black/10 dark:border-white/10 rounded-2xl",
									input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base lg:text-small",
								},
							}}
							className="flex-1 max-w-full"
							isVirtualized={true}
							itemHeight={64}
						>
							{[
								<AutocompleteItem 
									key="all"
									startContent={<BsFolder className="text-black/40 dark:text-white/40" />}
								>
									{t("allTopics")}
								</AutocompleteItem>,
								...filteredTopics.map((topic) => {
								const pathParts = topic.value.split('/');
								const level = pathParts.length;
								const topLevelTopic = pathParts[0];
								const displayName = pathParts[pathParts.length - 1];
								
								return (
									<AutocompleteItem 
										key={topic.value}
										startContent={
											<div className="flex items-center gap-2">
												<BsFolder className="text-black/40 dark:text-white/40" />
												{level > 1 && (
													<span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
														L{level}
													</span>
												)}
											</div>
										}
										description={
											level > 1 
												? `${topLevelTopic} → ${topic.count.toLocaleString()} items`
												: `${topic.count.toLocaleString()} items`
										}
										textValue={`${displayName} ${topic.value}`}
									>
										<div className="flex flex-col">
											<span className="font-medium">{displayName}</span>
											{level > 1 && (
												<span className="text-xs text-black/50 dark:text-white/50 truncate">
													{topic.value}
												</span>
											)}
										</div>
									</AutocompleteItem>
								);
							})
							]}
						</Autocomplete>
					</div>
				</motion.div>

				{/* Overall Stats */}
				<motion.div variants={itemVariants} className="grid grid-cols-1 md:grid-cols-4 gap-6">
					<div className="text-center p-6 rounded-2xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20">
						<div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-2">
							{overallStats.totalCitations.toLocaleString()}
						</div>
						<div className="text-sm font-medium text-black/60 dark:text-white/60">
							{t("totalCitations")}
						</div>
					</div>
					<div className="text-center p-6 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20">
						<div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 mb-2">
							{overallStats.totalItems.toLocaleString()}
						</div>
						<div className="text-sm font-medium text-black/60 dark:text-white/60">
							{t("totalItems")}
						</div>
					</div>
					<div className="text-center p-6 rounded-2xl bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20">
						<div className="text-3xl font-bold text-amber-600 dark:text-amber-400 mb-2">
							{overallStats.avgCitationsPerItem}
						</div>
						<div className="text-sm font-medium text-black/60 dark:text-white/60">
							{t("avgCitationsPerItem")}
						</div>
					</div>
					<div className="text-center p-6 rounded-2xl bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20">
						<div className="text-3xl font-bold text-purple-600 dark:text-purple-400 mb-2">
							{overallStats.yearsCovered}
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
					<Card color="card" className="p-6 relative">
						{isFiltering && (
							<div className="absolute inset-0 bg-white/80 dark:bg-black/80 backdrop-blur-sm rounded-2xl flex items-center justify-center z-10">
								<div className="flex items-center gap-3">
									<div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
									<span className="text-sm font-medium text-black/80 dark:text-white/80">
										{t("loadingData")}
									</span>
								</div>
							</div>
						)}
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
										formatter={(value: number, name: string) => {
											if (name === t("totalCitations")) {
												return [value.toLocaleString(), t("totalCitations")];
											} else if (name === t("avgCitationsPerItem")) {
												return [value.toFixed(2), t("avgCitationsPerItem")];
											}
											return [value, name];
										}}
										labelFormatter={(label) => `${t("year")} ${label}`}
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
										stroke="#10B981"
										strokeWidth={3}
										dot={{ fill: "#10B981", strokeWidth: 2, r: 4 }}
										activeDot={{ r: 6, stroke: "#10B981", strokeWidth: 2 }}
										name={t("avgCitationsPerItem")}
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