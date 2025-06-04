"use client";

import { Card } from "@/components/nextui/Card";
import {
	Progress,
	Table,
	TableHeader,
	TableColumn,
	TableBody,
	TableRow,
	TableCell,
} from "@nextui-org/react";
import { Switch } from "@/components/nextui/Switch";
import { Input } from "@/components/nextui/Input";
import { Pagination } from "@/components/nextui/Pagination";
import { Divider } from "@nextui-org/react";
import PageContainer from "./PageContainer";
import { useMemo, useState, useEffect } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import {
	BsBarChart,
	BsCalendar,
	BsPeople,
	BsFileText,
	BsGlobe,
	BsBuilding,
	BsJournalText,
	BsActivity,
	BsCheckCircle,
	BsGraphUp,
	BsPaperclip,
	BsFlag,
	BsSearch,
} from "react-icons/bs";
import { motion } from "framer-motion";
import {
	Chart as ChartJS,
	CategoryScale,
	LinearScale,
	BarElement,
	Title,
	Tooltip,
	Legend,
	ArcElement,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import { Bar, Doughnut } from "react-chartjs-2";
import resolveConfig from "tailwindcss/resolveConfig";
import tailwindConfig from "../../../tailwind.config";

ChartJS.register(
	CategoryScale,
	LinearScale,
	BarElement,
	Title,
	Tooltip,
	Legend,
	ArcElement,
	ChartDataLabels
);

const fullConfig = resolveConfig(tailwindConfig);

export type ExtendedTheme = typeof fullConfig & {
	theme: {
		colors: {
			accent: any;
		};
	};
};

type InstitutionStats = {
	institution: string;
	countryCode: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
};

type ItemTypeStats = {
	itemType: string;
	count: number;
	percentage: number;
};

type YearStats = {
	year: string;
	count: number;
};

type CitationStats = {
	totalItems: number;
	itemsWithCitations: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	maxCitations: number;
	citationPercentage: number;
};

type CreatorStats = {
	totalCreators: number;
	uniqueCreators: number;
	avgCreatorsPerItem: number;
	maxCreatorsPerItem: number;
};

type FieldStats = {
	field: string;
	filledCount: number;
	percentage: number;
};

type AttachmentStats = {
	totalAttachments: number;
	itemsWithAttachments: number;
	attachmentPercentage: number;
};

type AuthorCountryStats = {
	countryCode: string;
	countryName: string;
	authorCount: number;
	itemCount: number;
};

type ComprehensiveStats = {
	institutions: InstitutionStats[];
	itemTypes: ItemTypeStats[];
	yearDistribution: YearStats[];
	citationStats: CitationStats;
	creatorStats: CreatorStats;
	fieldCompleteness: FieldStats[];
	attachmentStats: AttachmentStats;
	authorCountries: AuthorCountryStats[];
	topPublishers: { publisher: string; count: number }[];
	topJournals: { journal: string; count: number }[];
	languageDistribution: { language: string; count: number }[];
	recentActivity: { date: string; count: number }[];
};

type StatisticsPageProps = {
	stats: ComprehensiveStats;
};

const containerVariants = {
	hidden: { opacity: 0 },
	show: {
		opacity: 1,
		transition: {
			staggerChildren: 0.1,
		},
	},
};

const itemVariants = {
	hidden: { y: 20, opacity: 0 },
	show: { y: 0, opacity: 1 },
};

function StatCard({
	title,
	value,
	subtitle,
	icon: Icon,
	color = "accent",
}: {
	title: string;
	value: string | number;
	subtitle?: string;
	icon: React.ElementType;
	color?: "accent" | "success" | "tertiary" | "card";
}) {
	return (
		<motion.div variants={itemVariants}>
			<Card
				color="card"
				className="px-6 h-32 flex justify-center items-center"
			>
				<div className="flex items-center gap-4 w-full justify-center">
					<div
						className={`p-3 rounded-2xl ${
							color === "accent"
								? "bg-accent/20"
								: color === "success"
								? "bg-success/20"
								: color === "tertiary"
								? "bg-tertiary/20"
								: "bg-white/10 dark:bg-white/5"
						}`}
					>
						<Icon
							className={`size-6 ${
								color === "accent"
									? "text-accent"
									: color === "success"
									? "text-success"
									: color === "tertiary"
									? "text-tertiary"
									: "text-black/60 dark:text-white/60"
							}`}
						/>
					</div>
					<div className="flex-1">
						<h3 className="text-sm font-medium text-black/60 dark:text-white/60 mb-1">
							{title}
						</h3>
						<p className="text-2xl font-bold text-black dark:text-white">
							{typeof value === "number"
								? value.toLocaleString()
								: value}
						</p>
						{subtitle && (
							<p className="text-xs text-black/40 dark:text-white/40 mt-1">
								{subtitle}
							</p>
						)}
					</div>
				</div>
			</Card>
		</motion.div>
	);
}

function SectionCard({
	title,
	icon: Icon,
	children,
}: {
	title: string;
	icon: React.ElementType;
	children: React.ReactNode;
}) {
	return (
		<motion.div variants={itemVariants}>
			<Card color="card" className="p-6">
				<div className="flex items-center gap-3 mb-6">
					<div className="p-2 rounded-xl bg-accent/20">
						<Icon className="size-5 text-accent" />
					</div>
					<h2 className="text-xl font-semibold text-black dark:text-white">
						{title}
					</h2>
				</div>
				{children}
			</Card>
		</motion.div>
	);
}

function ProgressItem({
	label,
	value,
	percentage,
	total,
}: {
	label: string;
	value: number;
	percentage: number;
	total: number;
}) {
	const t = useTranslations("ui");
	const tArticle = useTranslations("article");
	return (
		<div className="space-y-3">
			<div className="flex justify-between items-center">
				<span className="text-sm font-medium text-black dark:text-white">
					{tArticle(label)}
				</span>
				<span className="text-xs text-black/60 dark:text-white/60">
					{percentage.toFixed(1)}%
				</span>
			</div>
			<Progress
				value={percentage}
				color="primary"
				size="sm"
				className="w-full"
				classNames={{
					track: "bg-black/10 dark:bg-white/10",
					indicator: "bg-accent",
				}}
			/>
			<div className="flex justify-between text-xs text-black/40 dark:text-white/40">
				<span>
					{value.toLocaleString()} {t("itemsLowercase")}
				</span>
				<span>
					{t("of")} {total.toLocaleString()}
				</span>
			</div>
		</div>
	);
}

export default function StatisticsPage({ stats }: StatisticsPageProps) {
	const formatter = useFormatter();
	const t = useTranslations("ui");
	const tItemType = useTranslations("itemType");
	const { theme } = useTheme();
	const [institutionsPage, setInstitutionsPage] = useState(1);
	const [journalsPage, setJournalsPage] = useState(1);
	const [countriesPage, setCountriesPage] = useState(1);
	const [institutionsSearch, setInstitutionsSearch] = useState("");
	const [showTopCountryOnly, setShowTopCountryOnly] = useState(false);
	const rowsPerPage = 10;

	// Find the country with the most items
	const topCountry = useMemo(() => {
		if (stats.authorCountries.length === 0) return null;
		return stats.authorCountries[0]; // Already sorted by item count desc
	}, [stats.authorCountries]);

	const filteredInstitutions = useMemo(() => {
		let filtered = stats.institutions;

		// Filter by top country institutions if toggle is on
		if (showTopCountryOnly && topCountry) {
			filtered = filtered.filter(
				(institution) =>
					institution.countryCode === topCountry.countryCode
			);
		}

		// Filter by search term
		if (institutionsSearch.trim()) {
			filtered = filtered.filter((institution) =>
				institution.institution
					.toLowerCase()
					.includes(institutionsSearch.toLowerCase())
			);
		}

		return filtered;
	}, [
		stats.institutions,
		institutionsSearch,
		showTopCountryOnly,
		topCountry,
	]);

	const paginatedInstitutions = useMemo(() => {
		const start = (institutionsPage - 1) * rowsPerPage;
		const end = start + rowsPerPage;
		return filteredInstitutions.slice(start, end);
	}, [filteredInstitutions, institutionsPage]);

	const paginatedJournals = useMemo(() => {
		const start = (journalsPage - 1) * rowsPerPage;
		const end = start + rowsPerPage;
		return stats.topJournals.slice(start, end);
	}, [stats.topJournals, journalsPage]);

	const paginatedCountries = useMemo(() => {
		const start = (countriesPage - 1) * rowsPerPage;
		const end = start + rowsPerPage;
		return stats.authorCountries.slice(start, end);
	}, [stats.authorCountries, countriesPage]);

	const institutionsPages = Math.ceil(
		filteredInstitutions.length / rowsPerPage
	);
	const journalsPages = Math.ceil(stats.topJournals.length / rowsPerPage);
	const countriesPages = Math.ceil(
		stats.authorCountries.length / rowsPerPage
	);

	// Reset institutions page when search changes
	useEffect(() => {
		setInstitutionsPage(1);
	}, [institutionsSearch, showTopCountryOnly]);

	const chartData = {
		labels: stats.yearDistribution.slice(0, 15).map((year) => year.year),
		datasets: [
			{
				label: t("publications"),
				data: stats.yearDistribution
					.slice(0, 15)
					.map((year) => year.count),
				backgroundColor: (fullConfig as ExtendedTheme).theme.colors
					.accent.DEFAULT,
				borderColor: (fullConfig as ExtendedTheme).theme.colors.accent
					.DEFAULT,
				borderWidth: 1,
				borderRadius: 8,
				borderSkipped: false,
			},
		],
	};

	const chartOptions = {
		responsive: true,
		maintainAspectRatio: false,
		plugins: {
			legend: {
				display: false,
			},
			datalabels: {
				display: false,
			},
			tooltip: {
				backgroundColor:
					theme === "dark"
						? "rgba(0, 0, 0, 0.8)"
						: "rgba(255, 255, 255, 0.9)",
				titleColor: theme === "dark" ? "#ffffff" : "#000000",
				bodyColor: theme === "dark" ? "#ffffff" : "#000000",
				borderColor:
					theme === "dark"
						? "rgba(255, 255, 255, 0.1)"
						: "rgba(0, 0, 0, 0.1)",
				borderWidth: 1,
				cornerRadius: 8,
				displayColors: false,
				callbacks: {
					title: (context: any) => `${t("year")} ${context[0].label}`,
					label: (context: any) =>
						`${context.parsed.y.toLocaleString()} ${t(
							"publicationsLowercase"
						)}`,
				},
			},
		},
		scales: {
			x: {
				grid: {
					display: false,
				},
				ticks: {
					color:
						theme === "dark"
							? "rgba(255, 255, 255, 0.6)"
							: "rgba(0, 0, 0, 0.6)",
					font: {
						size: 12,
					},
				},
			},
			y: {
				beginAtZero: true,
				grid: {
					color:
						theme === "dark"
							? "rgba(255, 255, 255, 0.1)"
							: "rgba(0, 0, 0, 0.1)",
				},
				ticks: {
					color:
						theme === "dark"
							? "rgba(255, 255, 255, 0.6)"
							: "rgba(0, 0, 0, 0.6)",
					font: {
						size: 12,
					},
					callback: function (value: any) {
						return value.toLocaleString();
					},
				},
			},
		},
	};

	return (
		<PageContainer className="space-y-8">
			<motion.div
				initial="hidden"
				animate="show"
				variants={containerVariants}
				className="space-y-8"
			>
				{/* Header */}
				<motion.div
					variants={itemVariants}
					className="text-center space-y-4"
				>
					<h1 className="text-4xl font-bold text-black dark:text-white">
						{t("databaseStatistics")}
					</h1>
					<p className="text-lg text-black/60 dark:text-white/60 max-w-2xl mx-auto">
						{t("databaseStatisticsDescription")}
					</p>
				</motion.div>

				{/* Overview Stats */}
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
					<StatCard
						title={t("totalItems")}
						value={stats.citationStats.totalItems}
						subtitle={t("inDatabase")}
						icon={BsFileText}
						color="accent"
					/>
					<StatCard
						title={t("totalCitations")}
						value={stats.citationStats.totalCitations}
						subtitle={`${
							stats.citationStats.citationPercentage
						}% ${t("haveCitations")}`}
						icon={BsGraphUp}
						color="success"
					/>
					<StatCard
						title={t("uniqueCreators")}
						value={stats.creatorStats.uniqueCreators}
						subtitle={`${t(
							"avg"
						)} ${stats.creatorStats.avgCreatorsPerItem.toFixed(
							1
						)} ${t("perItem")}`}
						icon={BsPeople}
						color="tertiary"
					/>
					<StatCard
						title={t("institutions")}
						value={stats.institutions.length}
						subtitle={t("uniqueInstitutions")}
						icon={BsBuilding}
						color="card"
					/>
					<StatCard
						title={t("attachments")}
						value={stats.attachmentStats.totalAttachments}
						subtitle={`${
							stats.attachmentStats.attachmentPercentage
						}% ${t("ofItemsHaveAttachments")}`}
						icon={BsPaperclip}
						color="accent"
					/>
				</div>

				{/* Data Completeness */}
				<SectionCard title={t("dataCompleteness")} icon={BsCheckCircle}>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
						{stats.fieldCompleteness.map((field, index) => (
							<ProgressItem
								key={index}
								label={field.field}
								value={field.filledCount}
								percentage={field.percentage}
								total={stats.citationStats.totalItems}
							/>
						))}
					</div>
				</SectionCard>

				{/* Item Types & Years */}
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
					<SectionCard
						title={t("itemTypesDistribution")}
						icon={BsBarChart}
					>
						<div className="space-y-4 h-96 overflow-y-auto">
							{stats.itemTypes.map((type, index) => (
								<div
									key={index}
									className="flex justify-between items-center p-3 rounded-xl bg-black/5 dark:bg-white/5"
								>
									<span className="font-medium text-black dark:text-white">
										{tItemType(type.itemType)}
									</span>
									<div className="text-right">
										<div className="font-bold text-accent">
											{type.count.toLocaleString()}
										</div>
										<div className="text-xs text-black/60 dark:text-white/60">
											{type.percentage}%
										</div>
									</div>
								</div>
							))}
						</div>
					</SectionCard>

					<SectionCard title={t("recentYears")} icon={BsCalendar}>
						<div className="h-96">
							<Bar data={chartData} options={chartOptions} />
						</div>
					</SectionCard>
				</div>

				{/* Citation Analysis */}
				<SectionCard title={t("citationAnalysis")} icon={BsGraphUp}>
					<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
						<div className="text-center p-6 rounded-xl bg-success/10">
							<div className="text-3xl font-bold text-success mb-2">
								{stats.citationStats.itemsWithCitations.toLocaleString()}
							</div>
							<div className="text-sm text-black/60 dark:text-white/60">
								{t("itemsWithCitations")}
							</div>
						</div>
						<div className="text-center p-6 rounded-xl bg-accent/10">
							<div className="text-3xl font-bold text-accent mb-2">
								{stats.citationStats.avgCitationsPerItem.toFixed(
									2
								)}
							</div>
							<div className="text-sm text-black/60 dark:text-white/60">
								{t("averageCitationsPerItem")}
							</div>
						</div>
						<div className="text-center p-6 rounded-xl bg-tertiary/10">
							<div className="text-3xl font-bold text-tertiary mb-2">
								{stats.citationStats.maxCitations.toLocaleString()}
							</div>
							<div className="text-sm text-black/60 dark:text-white/60">
								{t("highestCitationCount")}
							</div>
						</div>
					</div>
				</SectionCard>

				{/* Institutions Table */}
				<SectionCard title={t("allInstitutions")} icon={BsBuilding}>
					<div className="space-y-4">
						<div className="space-y-4">
							<Input
								label={t("searchInstitutions")}
								value={institutionsSearch}
								onChange={(e) =>
									setInstitutionsSearch(e.target.value)
								}
								placeholder={t("searchByInstitutionName")}
								startContent={
									<BsSearch className="text-black/40 dark:text-white/40" />
								}
							/>
							<Card color="card">
								{topCountry && (
									<div className="flex items-center gap-2 mb-2">
										<div className="w-5 h-3 rounded-sm overflow-hidden shadow-sm flex-shrink-0">
											<img
												src={`https://flagcdn.com/${topCountry.countryCode.toLowerCase()}.svg`}
												alt={topCountry.countryCode}
												className="w-full h-full object-cover"
											/>
										</div>
										<span className="text-sm font-medium text-black dark:text-white">
											{topCountry.countryName} (
											{topCountry.itemCount.toLocaleString()}{" "}
											{t("itemsLowercase")})
										</span>
									</div>
								)}
								<Switch
									isSelected={showTopCountryOnly}
									onValueChange={setShowTopCountryOnly}
									isDisabled={!topCountry}
								>
									<span className="text-sm text-black dark:text-white">
										{t("showOnly")}{" "}
										{topCountry?.countryName ||
											t("topCountry")}{" "}
									</span>
								</Switch>
							</Card>
						</div>
						<Table
							aria-label={t("institutionsTableAriaLabel")}
							classNames={{
								wrapper: "bg-transparent shadow-none",
								th: "bg-black/5 dark:bg-white/5 text-black dark:text-white",
								td: "text-black dark:text-white",
							}}
						>
							<TableHeader>
								<TableColumn>
									{t("institutionColumn")}
								</TableColumn>
								<TableColumn>{t("countryColumn")}</TableColumn>
								<TableColumn>{t("itemsColumn")}</TableColumn>
								<TableColumn>
									{t("citationsColumn")}
								</TableColumn>
								<TableColumn>
									{t("avgPerItemColumn")}
								</TableColumn>
							</TableHeader>
							<TableBody>
								{paginatedInstitutions.map(
									(institution, index) => (
										<TableRow key={index}>
											<TableCell className="font-medium">
												{institution.institution}
											</TableCell>
											<TableCell>
												<div className="flex items-center gap-2">
													<div className="w-6 h-4 rounded-sm overflow-hidden shadow-sm flex-shrink-0">
														<img
															src={`https://flagcdn.com/${institution.countryCode.toLowerCase()}.svg`}
															alt={
																institution.countryCode
															}
															className="w-full h-full object-cover"
														/>
													</div>
													<span className="text-sm font-medium">
														{
															institution.countryCode
														}
													</span>
												</div>
											</TableCell>
											<TableCell>
												<span className="font-bold text-accent">
													{institution.itemCount.toLocaleString()}
												</span>
											</TableCell>
											<TableCell>
												<span className="font-bold text-success">
													{institution.totalCitations.toLocaleString()}
												</span>
											</TableCell>
											<TableCell>
												<span className="font-bold text-tertiary">
													{institution.avgCitationsPerItem.toFixed(
														1
													)}
												</span>
											</TableCell>
										</TableRow>
									)
								)}
							</TableBody>
						</Table>
						{institutionsPages > 1 && (
							<div className="flex justify-center">
								<Pagination
									total={institutionsPages}
									page={institutionsPage}
									onChange={setInstitutionsPage}
									showControls
									size="sm"
								/>
							</div>
						)}
					</div>
				</SectionCard>

				{/* Language Distribution */}
				<SectionCard title={t("languageDistribution")} icon={BsGlobe}>
					<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
						{stats.languageDistribution.map((lang, index) => (
							<div
								key={index}
								className="text-center p-4 rounded-xl bg-black/5 dark:bg-white/5"
							>
								<div className="font-bold text-black dark:text-white">
									{lang.language}
								</div>
								<div className="text-sm text-black/60 dark:text-white/60">
									{lang.count.toLocaleString()}
								</div>
							</div>
						))}
					</div>
				</SectionCard>

				{/* Author Countries */}
				<SectionCard title={t("authorCountries")} icon={BsFlag}>
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
						{/* Chart */}
						<div className="h-96 flex items-center justify-center">
							<Doughnut
								data={{
									labels: stats.authorCountries
										.slice(0, 10)
										.map((country) => country.countryName),
									datasets: [
										{
											data: stats.authorCountries
												.slice(0, 10)
												.map(
													(country) =>
														country.itemCount
												),
											backgroundColor: [
												"#FF6B6B", // Red
												"#4ECDC4", // Teal
												"#45B7D1", // Blue
												"#96CEB4", // Green
												"#FFEAA7", // Yellow
												"#DDA0DD", // Plum
												"#98D8C8", // Mint
												"#F7DC6F", // Light Yellow
												"#BB8FCE", // Light Purple
												"#85C1E9", // Light Blue
											],
											borderWidth: 2,
											borderColor:
												theme === "dark"
													? "#1a1a1a"
													: "#ffffff",
										},
									],
								}}
								options={{
									responsive: true,
									maintainAspectRatio: false,
									plugins: {
										legend: {
											display: false,
										},
										datalabels: {
											color:
												theme === "dark"
													? "#ffffff"
													: "#000000",
											font: {
												size: 11,
												weight: "bold",
											},
											formatter: (value, context) => {
												const data = context.dataset
													.data as number[];
												const total = data.reduce(
													(a: number, b: number) =>
														a + b,
													0
												);
												const percentage =
													((value as number) /
														total) *
													100;

												// Only show label if percentage is above 5% (enough space)
												if (percentage > 5) {
													const countryName = context
														.chart.data.labels?.[
														context.dataIndex
													] as string;
													// Truncate long country names
													if (
														countryName &&
														countryName.length > 12
													) {
														return (
															countryName.substring(
																0,
																10
															) + "..."
														);
													}
													return countryName;
												}
												return "";
											},
											anchor: "center",
											align: "center",
											clip: false,
										},
										tooltip: {
											backgroundColor:
												theme === "dark"
													? "rgba(0, 0, 0, 0.8)"
													: "rgba(255, 255, 255, 0.9)",
											titleColor:
												theme === "dark"
													? "#ffffff"
													: "#000000",
											bodyColor:
												theme === "dark"
													? "#ffffff"
													: "#000000",
											borderColor:
												theme === "dark"
													? "rgba(255, 255, 255, 0.1)"
													: "rgba(0, 0, 0, 0.1)",
											borderWidth: 1,
											cornerRadius: 8,
											displayColors: true,
											callbacks: {
												label: (context: any) => {
													const country =
														stats.authorCountries[
															context.dataIndex
														];
													return [
														`${context.label}: ${
															context.parsed
														} ${t(
															"itemsLowercase"
														)}`,
														`${t(
															"authorsLabel"
														)} ${country.authorCount.toLocaleString()}`,
													];
												},
											},
										},
									},
								}}
							/>
						</div>

						{/* Statistics */}
						<div className="space-y-4">
							<div className="grid grid-cols-2 gap-4">
								<div className="text-center p-4 rounded-xl bg-accent/10">
									<div className="text-2xl font-bold text-accent">
										{stats.authorCountries.length}
									</div>
									<div className="text-sm text-black/60 dark:text-white/60">
										{t("countries")}
									</div>
								</div>
								<div className="text-center p-4 rounded-xl bg-success/10">
									<div className="text-2xl font-bold text-success">
										{stats.creatorStats.uniqueCreators.toLocaleString()}
									</div>
									<div className="text-sm text-black/60 dark:text-white/60">
										{t("uniqueAuthors")}
									</div>
								</div>
							</div>

							{/* Top Countries List */}
							<div className="space-y-3 max-h-64 overflow-y-auto">
								{stats.authorCountries
									.slice(0, 8)
									.map((country, index) => (
										<div
											key={index}
											className="flex items-center gap-3 p-3 rounded-xl bg-black/5 dark:bg-white/5"
										>
											<div className="w-6 h-4 rounded-sm overflow-hidden shadow-sm flex-shrink-0">
												<img
													src={`https://flagcdn.com/${country.countryCode.toLowerCase()}.svg`}
													alt={country.countryCode}
													className="w-full h-full object-cover"
												/>
											</div>
											<div className="flex-1 min-w-0">
												<div className="font-medium text-black dark:text-white truncate">
													{country.countryName}
												</div>
												<div className="text-xs text-black/60 dark:text-white/60">
													{country.authorCount.toLocaleString()}
												</div>
											</div>
											<div className="text-right">
												<div className="font-bold text-accent">
													{country.itemCount.toLocaleString()}
												</div>
												<div className="text-xs text-black/60 dark:text-white/60">
													{t("itemsLowercase")}
												</div>
											</div>
										</div>
									))}
							</div>
						</div>
					</div>
				</SectionCard>

				{/* Author Countries Table */}
				<SectionCard title={t("authorCountriesTable")} icon={BsFlag}>
					<div className="space-y-4">
						<Table
							aria-label={t("coAuthorCountriesStatsAriaLabel")}
							classNames={{
								wrapper: "bg-transparent shadow-none",
								th: "bg-black/5 dark:bg-white/5 text-black dark:text-white",
								td: "text-black dark:text-white",
							}}
						>
							<TableHeader>
								<TableColumn key="country" allowsSorting>
									{t("countryColumn")}
								</TableColumn>
								<TableColumn key="authors" allowsSorting>
									{t("uniqueAuthorsColumn")}
								</TableColumn>
								<TableColumn key="items" allowsSorting>
									{t("itemsColumn")}
								</TableColumn>
								<TableColumn key="avgItems" allowsSorting>
									{t("avgItemsPerAuthorColumn")}
								</TableColumn>
							</TableHeader>
							<TableBody items={paginatedCountries}>
								{(country) => (
									<TableRow key={country.countryCode}>
										<TableCell>
											<div className="flex items-center gap-3">
												<div className="w-6 h-4 rounded-sm overflow-hidden shadow-sm flex-shrink-0">
													<img
														src={`https://flagcdn.com/${country.countryCode.toLowerCase()}.svg`}
														alt={
															country.countryCode
														}
														className="w-full h-full object-cover"
													/>
												</div>
												<div>
													<div className="font-medium">
														{country.countryName}
													</div>
													<div className="text-xs text-black/60 dark:text-white/60">
														{country.countryCode}
													</div>
												</div>
											</div>
										</TableCell>
										<TableCell>
											<div className="font-medium">
												{country.authorCount.toLocaleString()}
											</div>
										</TableCell>
										<TableCell>
											<div className="font-medium">
												{country.itemCount.toLocaleString()}
											</div>
										</TableCell>
										<TableCell>
											<div className="font-medium">
												{(
													country.itemCount /
													country.authorCount
												).toFixed(1)}
											</div>
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
						{countriesPages > 1 && (
							<div className="flex justify-center">
								<Pagination
									total={countriesPages}
									page={countriesPage}
									onChange={setCountriesPage}
									showControls
									size="sm"
								/>
							</div>
						)}
					</div>
				</SectionCard>

				{/* Top Journals Table */}
				{stats.topJournals.length > 0 && (
					<SectionCard title={t("topJournals")} icon={BsJournalText}>
						<div className="space-y-4">
							<Table
								aria-label={t("topJournalsTableAriaLabel")}
								classNames={{
									wrapper: "bg-transparent shadow-none",
									th: "bg-black/5 dark:bg-white/5 text-black dark:text-white",
									td: "text-black dark:text-white",
								}}
							>
								<TableHeader>
									<TableColumn>
										{t("journalColumn")}
									</TableColumn>
									<TableColumn>
										{t("articlesColumn")}
									</TableColumn>
								</TableHeader>
								<TableBody>
									{paginatedJournals.map((journal, index) => (
										<TableRow key={index}>
											<TableCell className="font-medium">
												{journal.journal}
											</TableCell>
											<TableCell>
												<span className="font-bold text-success">
													{journal.count.toLocaleString()}
												</span>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
							{journalsPages > 1 && (
								<div className="flex justify-center">
									<Pagination
										total={journalsPages}
										page={journalsPage}
										onChange={setJournalsPage}
										showControls
										size="sm"
									/>
								</div>
							)}
						</div>
					</SectionCard>
				)}

				{/* Recent Activity */}
				{stats.recentActivity.length > 0 && (
					<SectionCard title={t("recentActivity")} icon={BsActivity}>
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
							{stats.recentActivity.map((activity, index) => (
								<div
									key={index}
									className="flex justify-between items-center p-3 rounded-xl bg-black/5 dark:bg-white/5"
								>
									<span className="font-medium text-black dark:text-white">
										{formatter.dateTime(
											new Date(activity.date),
											{
												month: "short",
												day: "numeric",
											}
										)}
									</span>
									<span className="font-bold text-tertiary">
										{activity.count.toLocaleString()}
									</span>
								</div>
							))}
						</div>
					</SectionCard>
				)}
			</motion.div>
		</PageContainer>
	);
}
