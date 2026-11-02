import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { BarChartIcon, Building02Icon, Cancel01Icon, FilterIcon, Folder01Icon, QuoteUpIcon } from "@hugeicons/core-free-icons";
import { useMemo, useState, memo, Fragment } from "react";
import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
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

function LevelBadge({ level }: { level: number }) {
	if (level <= 1) return null;
	return <span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">L{level}</span>;
}

/** The first 200 entries whose text holds the search. */
function firstMatches<T>(entries: T[], search: string, text: (entry: T) => string[]) {
	const wanted = search.trim().toLowerCase();
	const matching = wanted ? entries.filter((entry) => text(entry).some((part) => part.toLowerCase().includes(wanted))) : entries;
	return matching.slice(0, 200);
}

function datedInOrder<T extends { year: string }>(rows: readonly T[]) {
	return rows.filter((item) => item.year && !isNaN(parseInt(item.year))).sort((a, b) => parseInt(a.year) - parseInt(b.year));
}

function OptionalFlag({ countryCode }: { countryCode: string | undefined | null }) {
	return countryCode ? <CountryFlag countryCode={countryCode} className="w-5 h-3" /> : null;
}

function YearTooltip({ active, payload, label }: { active?: boolean; payload?: readonly { payload?: unknown }[]; label?: ReactNode }) {
	const t = useTranslations("ui");
	const locale = useLocale();
	const data = payload?.[0]?.payload as { totalCitations?: number; avgCitationsPerItem?: number; itemCount?: number } | undefined;
	if (!active || !data) return null;
	const { totalCitations = 0, avgCitationsPerItem: avgCitations = 0, itemCount = 0 } = data;
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
						{totalCitations.toLocaleString(locale)}
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
						{avgCitations.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
						{itemCount.toLocaleString(locale)}
					</span>
				</div>
			</div>
		</div>
	);
	}

/** Choosing an institution or a topic clears the other: the chart shows one at a time. */
function chooser(choose: (value: string) => void, clearOther: (value: string) => void) {
	return (key: Key | null) => {
		choose((key as string) || "all");
		if (key !== "all") clearOther("all");
	};
}

function ClearFilters({ shown, onPress, label }: { shown: boolean; onPress: () => void; label: string }) {
	if (!shown) return null;
	return <Button size="sm" variant="flat" color="default" onPress={onPress} startContent={<HugeiconsIcon icon={Cancel01Icon} />}>{label}</Button>;
}

function countryNameOf(code: string | undefined | null) {
	return code ? COUNTRIES[code] : undefined;
}

type StatisticsTranslator = ReturnType<typeof useTranslations<"statistics">>;

function institutionOptions(rows: CitationsByYearProps["institutionsByYear"], t: StatisticsTranslator, locale: string) {
	const counts = new Map<string, number>();
	for (const item of rows) counts.set(item.institution, (counts.get(item.institution) ?? 0) + item.itemCount);
	return Array.from(counts.entries())
		.map(([name, count]) => ({ value: name, label: t("label", { name, count: count.toLocaleString(locale) }), count }))
		.sort((a, b) => b.count - a.count);
}

function topicOptions(rows: CitationsByYearProps["topicsByYear"], t: StatisticsTranslator, locale: string) {
	const counts = new Map<string, { topic: string; level: number; count: number }>();
	for (const item of rows) counts.set(item.id, { topic: item.topic, level: item.level, count: (counts.get(item.id)?.count ?? 0) + item.itemCount });
	return Array.from(counts.entries())
		.map(([id, { topic, level, count }]) => ({ value: id, topic, level, label: t("label2", { topic, count: count.toLocaleString(locale) }), count }))
		.sort((a, b) => b.count - a.count);
}

function chartTotals(rows: readonly { totalCitations: number; itemCount: number }[]) {
	const totalCitations = rows.reduce((sum, item) => sum + item.totalCitations, 0);
	const totalItems = rows.reduce((sum, item) => sum + item.itemCount, 0);
	const avgCitationsPerItem = totalItems > 0 ? totalCitations / totalItems : 0;
	return { totalCitations, totalItems, avgCitationsPerItem: Number(avgCitationsPerItem.toFixed(2)), yearsCovered: rows.length };
}

function tooltipBorder(theme: string | undefined) {
	return `1px solid ${theme === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"}`;
}

function chartRows(all: CitationsByYearProps["citationsByYear"], institutions: CitationsByYearProps["institutionsByYear"], topics: CitationsByYearProps["topicsByYear"], institution: string, topic: string) {
	if (institution !== "all") return perYear(institutions.filter((item) => item.institution === institution));
	if (topic !== "all") return perYear(topics.filter((item) => item.id === topic));
	return all;
}

function itemsLine(t: StatisticsTranslator, countryName: string | undefined | null, count: number, locale: string) {
	const value = count.toLocaleString(locale);
	return countryName ? t("items", { countryName, value }) : t("items2", { value });
}

export function CitationsByYear({ citationsByYear, institutionsByYear, topicsByYear }: CitationsByYearProps) {
	const locale = useLocale();
	const tLabels = useTranslations("statistics");
	const t = useTranslations("ui");
	const { resolvedTheme: theme } = useTheme();
	const [selectedInstitution, setSelectedInstitution] = useState<string>("all");
	const [selectedTopic, setSelectedTopic] = useState<string>("all");
	
	// Get all institutions with their counts (don't limit here)
	const allInstitutions = useMemo(() => institutionOptions(institutionsByYear, tLabels, locale), [institutionsByYear, tLabels, locale]);

	// Get all topics with their counts (don't limit here)
	const allTopics = useMemo(() => topicOptions(topicsByYear, tLabels, locale), [topicsByYear, tLabels, locale]);

	// Filter institutions based on search, then limit to 200
	const [institutionSearchTerm, setInstitutionSearchTerm] = useState("");
	const [topicSearchTerm, setTopicSearchTerm] = useState("");

	const filteredInstitutions = useMemo(() => firstMatches(allInstitutions, institutionSearchTerm, (inst) => [inst.value]), [allInstitutions, institutionSearchTerm]);

	// Filter topics based on search, then limit to 200
	const filteredTopics = useMemo(() => firstMatches(allTopics, topicSearchTerm, (topic) => [topic.value, topic.label]), [allTopics, topicSearchTerm]);

	// Process chart data based on filters
	const chartData = useMemo(() => {
		const selected = chartRows(citationsByYear, institutionsByYear, topicsByYear, selectedInstitution, selectedTopic);
		return datedInOrder(selected);
	}, [citationsByYear, institutionsByYear, topicsByYear, selectedInstitution, selectedTopic]);

	// Calculate stats
	const stats = useMemo(() => chartTotals(chartData), [chartData]);

	const handleInstitutionChange = chooser(setSelectedInstitution, setSelectedTopic);
	const handleTopicChange = chooser(setSelectedTopic, setSelectedInstitution);

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
						<ClearFilters shown={hasActiveFilters} onPress={clearFilters} label={t("clearFilters")} />
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
									const countryName = countryNameOf(countryCode);
									
									return (
										<AutocompleteItem 
											key={institution.value}
											startContent={
												<div className="flex items-center gap-2">
													<OptionalFlag countryCode={countryCode} />
													<HugeiconsIcon icon={Building02Icon} className="text-black/40 dark:text-white/40" />
												</div>
											}
											description={itemsLine(tLabels, countryName, institution.count, locale)}
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
													<LevelBadge level={level} />
												</div>
											}
											description={itemsLine(tLabels, undefined, topic.count, locale)}
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
							{stats.totalCitations.toLocaleString(locale)}
						</div>
						<div className="text-sm font-medium text-black/60 dark:text-white/60">
							{t("totalCitations")}
						</div>
					</div>
					<div className="text-center p-6 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20">
						<div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 mb-2">
							{stats.totalItems.toLocaleString(locale)}
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
										tickFormatter={(value) => value.toLocaleString(locale)}
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
										tickFormatter={(value) => value.toLocaleString(locale)}
									/>
									<Tooltip
										contentStyle={{
											backgroundColor: "transparent",
											border: tooltipBorder(theme),
											borderRadius: "16px",
											boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
											padding: "16px",
											minWidth: "200px",
										}}
										labelStyle={{ display: "none" }}
										itemStyle={{ display: "none" }}
										content={({ active, payload, label }) => <YearTooltip active={active} payload={payload} label={label} />}
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
