"use client";

import { Card } from "@/components/nextui/Card";
import { Table } from "@/components/nextui/Table";
import {
	Progress,
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
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
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
	BsDiagram3,
	BsShare,
	BsInfo,
	BsBookmark,
	BsLayers,
	BsTags,
} from "react-icons/bs";
import { motion } from "framer-motion";
import {
	BarChart,
	Bar,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	ResponsiveContainer,
	PieChart,
	Pie,
	Cell,
	Legend,
	LabelList,
} from "recharts";

type InstitutionStats = {
	institution: string;
	countryCode: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
};

type InstitutionYearStats = {
	institution: string;
	countryCode: string;
	year: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
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
	hIndex: number;
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
	hIndex: number;
};

type AuthorStats = {
	authorName: string;
	firstName: string;
	lastName: string;
	displayName: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
	countryCount: number;
	institutionCount: number;
	creatorTypes: string[];
	mostCommonCreatorType: string;
	countries: string[];
	institutions: string[];
	firstPublicationYear: number;
	lastPublicationYear: number;
	yearSpan: number;
	mostRecentYear: number;
};

type AuthorProductivityStats = {
	totalAuthors: number;
	authorsWithMultipleWorks: number;
	avgItemsPerAuthor: number;
	maxItemsPerAuthor: number;
	productivityDistribution: {
		range: string;
		count: number;
		percentage: number;
	}[];
};

type AuthorCollaborationStats = {
	soloAuthors: number;
	collaborativeAuthors: number;
	avgCollaboratorsPerAuthor: number;
	maxCollaboratorsPerAuthor: number;
	collaborationRate: number;
};

type CollaborationStats = {
	totalItems: number;
	collaborativeItems: number;
	overallCollaborationRate: number;
	baseCountry: {
		countryCode: string;
		countryName: string;
		totalItems: number;
		collaborativeItems: number;
		collaborationRate: number;
	};
	countryCollaborationRates: {
		countryCode: string;
		countryName: string;
		totalItems: number;
		// All international collaborations (including with base country)
		internationalItems: number;
		internationalRate: number;
		// International collaborations excluding base country
		independentItems: number;
		independentRate: number;
		// Domestic/solo publications (no international collaboration)
		domesticItems: number;
		domesticRate: number;
	}[];
	topCollaborations: {
		country1: string;
		country2: string;
		country1Name: string;
		country2Name: string;
		collaborationCount: number;
	}[];
	collaborationMatrix: {
		[key: string]: {
			[key: string]: number;
		};
	};
};

type TopicStats = {
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

type TopicOverview = {
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

type ComprehensiveStats = {
	institutions: InstitutionStats[];
	institutionsByYear: InstitutionYearStats[];
	availableYears: string[];
	itemTypes: ItemTypeStats[];
	yearDistribution: YearStats[];
	citationStats: CitationStats;
	creatorStats: CreatorStats;
	fieldCompleteness: FieldStats[];
	attachmentStats: AttachmentStats;
	authorCountries: AuthorCountryStats[];
	collaborationStats: CollaborationStats;
	authorStats: AuthorStats[];
	authorProductivityStats: AuthorProductivityStats;
	authorCollaborationStats: AuthorCollaborationStats;
	topPublishers: { publisher: string; count: number }[];
	topJournals: { journal: string; count: number }[];
	languageDistribution: { language: string; count: number }[];
	recentActivity: { date: string; count: number }[];
	topicStats: TopicStats[];
	topicOverview: TopicOverview;
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

function CountryFlag({ countryCode, className = "w-6 h-4" }: { countryCode: string; className?: string }) {
	if (!countryCode || countryCode.trim() === '') {
		return (
			<div className={`${className} rounded-sm bg-black/10 dark:bg-white/10 flex items-center justify-center flex-shrink-0`}>
				<BsGlobe className="w-3 h-3 text-black/40 dark:text-white/40" />
			</div>
		);
	}

	return (
		<div className={`${className} rounded-sm overflow-hidden shadow-sm flex-shrink-0`}>
			<img
				src={`https://flagcdn.com/${countryCode.toLowerCase()}.svg`}
				alt={countryCode}
				className="w-full h-full object-cover"
			/>
		</div>
	);
}

function CountryDisplay({ countryCode, countryName, showCode = false }: { countryCode: string; countryName: string; showCode?: boolean }) {
	const t = useTranslations("ui");
	
	if (!countryCode || countryCode.trim() === '') {
		return (
			<div className="flex items-center gap-2">
				<CountryFlag countryCode="" />
				<span className="text-sm font-medium text-black/60 dark:text-white/60">{t("unknownCountry")}</span>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-2">
			<CountryFlag countryCode={countryCode} />
			<span className="text-sm font-medium">
				{countryName || countryCode}
				{showCode && countryName && (
					<span className="text-xs text-black/60 dark:text-white/60 ml-1">({countryCode})</span>
				)}
			</span>
		</div>
	);
}

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
						className={`p-3 rounded-2xl ${color === "accent"
								? "bg-accent/20"
								: color === "success"
									? "bg-success/20"
									: color === "tertiary"
										? "bg-tertiary/20"
										: "bg-white/10 dark:bg-white/5"
							}`}
					>
						<Icon
							className={`size-6 ${color === "accent"
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
	"use no memo";
	const formatter = useFormatter();
	const t = useTranslations("ui");
	const tItemType = useTranslations("itemType");
	const { resolvedTheme: theme } = useTheme();
	const [institutionsPage, setInstitutionsPage] = useState(1);
	const [journalsPage, setJournalsPage] = useState(1);
	const [countriesPage, setCountriesPage] = useState(1);
	const [institutionsSearch, setInstitutionsSearch] = useState("");
	const [showTopCountryOnly, setShowTopCountryOnly] = useState(false);
	const [selectedYear, setSelectedYear] = useState<string>("all");
	const rowsPerPage = 10;

	// Sorting states for all tables
	const [institutionsSortDescriptor, setInstitutionsSortDescriptor] = useState<{ column: string, direction: "ascending" | "descending" }>({
		column: "itemCount",
		direction: "descending"
	});
	const [journalsSortDescriptor, setJournalsSortDescriptor] = useState<{ column: string, direction: "ascending" | "descending" }>({
		column: "count",
		direction: "descending"
	});
	const [countriesSortDescriptor, setCountriesSortDescriptor] = useState<{ column: string, direction: "ascending" | "descending" }>({
		column: "itemCount",
		direction: "descending"
	});
	const [collaborationSortDescriptor, setCollaborationSortDescriptor] = useState<{ column: string, direction: "ascending" | "descending" }>({
		column: "totalItems",
		direction: "descending"
	});
	const [authorsSortDescriptor, setAuthorsSortDescriptor] = useState<{ column: string, direction: "ascending" | "descending" }>({
		column: "itemCount",
		direction: "descending"
	});
	const [topicsSortDescriptor, setTopicsSortDescriptor] = useState<{ column: string, direction: "ascending" | "descending" }>({
		column: "itemCount",
		direction: "descending"
	});

	// Author pagination and search state
	const [authorsPage, setAuthorsPage] = useState(1);
	const [authorsSearch, setAuthorsSearch] = useState("");

	// Topic pagination and search state
	const [topicsPage, setTopicsPage] = useState(1);
	const [topicsSearch, setTopicsSearch] = useState("");
	const [selectedTopicLevel, setSelectedTopicLevel] = useState<string>("all");

	// Find the country with the most items
	const topCountry = useMemo(() => {
		if (stats.authorCountries.length === 0) return null;
		return stats.authorCountries[0]; // Already sorted by item count desc
	}, [stats.authorCountries]);

	// Aggregate institutions by year or use all-time data
	const aggregatedInstitutions = useMemo(() => {
		if (selectedYear === "all") {
			return stats.institutions;
		}

		// Aggregate data for the selected year
		const yearData = stats.institutionsByYear.filter(
			(inst) => inst.year === selectedYear
		);

		// Group by institution and sum up the data
		const institutionMap = new Map<string, InstitutionStats>();

		yearData.forEach((inst) => {
			const key = `${inst.institution}-${inst.countryCode}`;
			if (institutionMap.has(key)) {
				const existing = institutionMap.get(key)!;
				existing.itemCount += inst.itemCount;
				existing.totalCitations += inst.totalCitations;
				// Recalculate average citations per item
				existing.avgCitationsPerItem =
					existing.totalCitations / existing.itemCount;
				// For H-Index, we'd need to recalculate with all citation counts, but for simplicity, take the max
				existing.hIndex = Math.max(existing.hIndex, inst.hIndex);
			} else {
				institutionMap.set(key, {
					institution: inst.institution,
					countryCode: inst.countryCode,
					itemCount: inst.itemCount,
					totalCitations: inst.totalCitations,
					avgCitationsPerItem: inst.avgCitationsPerItem,
					hIndex: inst.hIndex,
				});
			}
		});

		return Array.from(institutionMap.values()).sort(
			(a, b) => b.itemCount - a.itemCount
		);
	}, [stats.institutions, stats.institutionsByYear, selectedYear]);

	const filteredInstitutions = useMemo(() => {
		let filtered = aggregatedInstitutions;

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

		// Apply sorting
		const sorted = [...filtered].sort((a, b) => {
			let aValue: any = a[institutionsSortDescriptor.column as keyof InstitutionStats];
			let bValue: any = b[institutionsSortDescriptor.column as keyof InstitutionStats];

			// Handle string sorting
			if (typeof aValue === "string") {
				aValue = aValue.toLowerCase();
				bValue = bValue.toLowerCase();
			}

			let comparison = 0;
			if (aValue < bValue) {
				comparison = -1;
			} else if (aValue > bValue) {
				comparison = 1;
			}

			return institutionsSortDescriptor.direction === "descending" ? -comparison : comparison;
		});

		return sorted;
	}, [
		aggregatedInstitutions,
		institutionsSearch,
		showTopCountryOnly,
		topCountry,
		institutionsSortDescriptor,
	]);

	const paginatedInstitutions = useMemo(() => {
		const start = (institutionsPage - 1) * rowsPerPage;
		const end = start + rowsPerPage;
		return filteredInstitutions.slice(start, end);
	}, [filteredInstitutions, institutionsPage]);

	const sortedJournals = useMemo(() => {
		return [...stats.topJournals].sort((a, b) => {
			let aValue: any = a[journalsSortDescriptor.column as keyof typeof a];
			let bValue: any = b[journalsSortDescriptor.column as keyof typeof b];

			// Handle string sorting
			if (typeof aValue === "string") {
				aValue = aValue.toLowerCase();
				bValue = bValue.toLowerCase();
			}

			let comparison = 0;
			if (aValue < bValue) {
				comparison = -1;
			} else if (aValue > bValue) {
				comparison = 1;
			}

			return journalsSortDescriptor.direction === "descending" ? -comparison : comparison;
		});
	}, [stats.topJournals, journalsSortDescriptor]);

	const sortedCountries = useMemo(() => {
		return [...stats.authorCountries].sort((a, b) => {
			let aValue: any;
			let bValue: any;

			// Handle special calculated fields
			if (countriesSortDescriptor.column === "avgItems") {
				aValue = a.itemCount / a.authorCount;
				bValue = b.itemCount / b.authorCount;
			} else {
				aValue = a[countriesSortDescriptor.column as keyof AuthorCountryStats];
				bValue = b[countriesSortDescriptor.column as keyof AuthorCountryStats];
			}

			// Handle string sorting
			if (typeof aValue === "string") {
				aValue = aValue.toLowerCase();
				bValue = bValue.toLowerCase();
			}

			let comparison = 0;
			if (aValue < bValue) {
				comparison = -1;
			} else if (aValue > bValue) {
				comparison = 1;
			}

			return countriesSortDescriptor.direction === "descending" ? -comparison : comparison;
		});
	}, [stats.authorCountries, countriesSortDescriptor]);

	const sortedCollaborationCountries = useMemo(() => {
		return [...stats.collaborationStats.countryCollaborationRates].sort((a, b) => {
			let aValue: any = a[collaborationSortDescriptor.column as keyof typeof a];
			let bValue: any = b[collaborationSortDescriptor.column as keyof typeof b];

			// Handle string sorting
			if (typeof aValue === "string") {
				aValue = aValue.toLowerCase();
				bValue = bValue.toLowerCase();
			}

			let comparison = 0;
			if (aValue < bValue) {
				comparison = -1;
			} else if (aValue > bValue) {
				comparison = 1;
			}

			return collaborationSortDescriptor.direction === "descending" ? -comparison : comparison;
		});
	}, [stats.collaborationStats.countryCollaborationRates, collaborationSortDescriptor]);

	const paginatedJournals = useMemo(() => {
		const start = (journalsPage - 1) * rowsPerPage;
		const end = start + rowsPerPage;
		return sortedJournals.slice(start, end);
	}, [sortedJournals, journalsPage]);

	const paginatedCountries = useMemo(() => {
		const start = (countriesPage - 1) * rowsPerPage;
		const end = start + rowsPerPage;
		return sortedCountries.slice(start, end);
	}, [sortedCountries, countriesPage]);

	const paginatedCollaborationCountries = useMemo(() => {
		const start = (countriesPage - 1) * rowsPerPage;
		const end = start + rowsPerPage;
		return sortedCollaborationCountries.slice(start, end);
	}, [sortedCollaborationCountries, countriesPage]);

	// Author filtering and sorting
	const filteredAuthors = useMemo(() => {
		let filtered = stats.authorStats;

		// Filter by search term
		if (authorsSearch.trim()) {
			filtered = filtered.filter((author) =>
				author.displayName.toLowerCase().includes(authorsSearch.toLowerCase()) ||
				author.authorName.toLowerCase().includes(authorsSearch.toLowerCase())
			);
		}

		// Apply sorting
		const sorted = [...filtered].sort((a, b) => {
			let aValue: any = a[authorsSortDescriptor.column as keyof AuthorStats];
			let bValue: any = b[authorsSortDescriptor.column as keyof AuthorStats];

			// Handle undefined values (e.g., removed collaboratorCount column)
			if (aValue === undefined) aValue = 0;
			if (bValue === undefined) bValue = 0;

			// Handle array sorting (for countries, institutions, creatorTypes)
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

			return authorsSortDescriptor.direction === "descending" ? -comparison : comparison;
		});

		return sorted;
	}, [stats.authorStats, authorsSearch, authorsSortDescriptor]);

	const paginatedAuthors = useMemo(() => {
		const start = (authorsPage - 1) * rowsPerPage;
		const end = start + rowsPerPage;
		return filteredAuthors.slice(start, end);
	}, [filteredAuthors, authorsPage]);

	const institutionsPages = Math.ceil(
		filteredInstitutions.length / rowsPerPage
	);
	const journalsPages = Math.ceil(sortedJournals.length / rowsPerPage);
	const countriesPages = Math.ceil(sortedCountries.length / rowsPerPage);
	const collaborationPages = Math.ceil(sortedCollaborationCountries.length / rowsPerPage);
	const authorsPages = Math.ceil(filteredAuthors.length / rowsPerPage);

	// Reset institutions page when search or filters change
	useEffect(() => {
		setInstitutionsPage(1);
	}, [institutionsSearch, showTopCountryOnly, selectedYear]);

	// Reset authors page when search changes
	useEffect(() => {
		setAuthorsPage(1);
	}, [authorsSearch]);

	// Reset topics page when search or filters change
	useEffect(() => {
		setTopicsPage(1);
	}, [topicsSearch, selectedTopicLevel]);

	// Topic filtering and sorting
	const filteredTopics = useMemo(() => {
		let filtered = stats.topicStats;

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
	}, [stats.topicStats, topicsSearch, selectedTopicLevel, topicsSortDescriptor]);

	const paginatedTopics = useMemo(() => {
		const start = (topicsPage - 1) * rowsPerPage;
		const end = start + rowsPerPage;
		return filteredTopics.slice(start, end);
	}, [filteredTopics, topicsPage]);

	const topicsPages = Math.ceil(filteredTopics.length / rowsPerPage);

	const chartData = stats.yearDistribution.slice(0, 15).map((year) => ({
		year: year.year,
		publications: year.count,
	}));

	const pieColors = [
		"#3B82F6", // Blue
		"#10B981", // Emerald
		"#F59E0B", // Amber
		"#EF4444", // Red
		"#8B5CF6", // Violet
		"#06B6D4", // Cyan
		"#84CC16", // Lime
		"#F97316", // Orange
		"#EC4899", // Pink
		"#6366F1", // Indigo
	];

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
				<div className="space-y-6">
					{/* Primary Stats */}
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
							subtitle={`${stats.citationStats.citationPercentage
								}% ${t("haveCitations")}`}
							icon={BsGraphUp}
							color="success"
						/>
						<StatCard
							title="H-Index"
							value={stats.citationStats.hIndex}
							subtitle={t("globalImpactMetric")}
							icon={BsActivity}
							color="tertiary"
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
							color="card"
						/>
					</div>

					{/* Secondary Stats */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
						<StatCard
							title={t("institutions")}
							value={stats.institutions.length}
							subtitle={t("uniqueInstitutions")}
							icon={BsBuilding}
							color="accent"
						/>
						<StatCard
							title={t("attachments")}
							value={stats.attachmentStats.totalAttachments}
							subtitle={`${stats.attachmentStats.attachmentPercentage
								}% ${t("ofItemsHaveAttachments")}`}
							icon={BsPaperclip}
							color="success"
						/>
					</div>
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
							<ResponsiveContainer width="100%" height="100%">
								<BarChart
									data={chartData}
									margin={{
										top: 0,
										right: 0,
										left: 0,
										bottom: 0,
									}}
								>
									<CartesianGrid
										strokeDasharray="3 3"
										className="stroke-black/10 dark:stroke-white/10"
									/>
									<XAxis
										dataKey="year"
										className="text-black/60 dark:text-white/60"
										tick={{ fontSize: 12 }}
										axisLine={false}
									/>
									<YAxis
										className="text-black/60 dark:text-white/60"
										tick={{ fontSize: 12 }}
										axisLine={false}
										tickFormatter={(value) =>
											value.toLocaleString()
										}
									/>
									<Tooltip
										contentStyle={{
											backgroundColor:
												theme === "dark"
													? "#1a1a1a"
													: "#ffffff",
											border: `1px solid ${theme === "dark"
													? "rgba(255, 255, 255, 0.1)"
													: "rgba(0, 0, 0, 0.1)"
												}`,
											borderRadius: "8px",
											boxShadow:
												"0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
										}}
										labelStyle={{
											color:
												theme === "dark"
													? "#ffffff"
													: "#000000",
											fontWeight: "500",
										}}
										itemStyle={{
											color:
												theme === "dark"
													? "rgba(255, 255, 255, 0.8)"
													: "rgba(0, 0, 0, 0.8)",
										}}
										labelFormatter={(label) =>
											`${t("year")} ${label}`
										}
										formatter={(value: number) => [
											value.toLocaleString() +
											` ${t(
												"publicationsLowercase"
											)}`,
											t("publications"),
										]}
									/>
									<Bar
										dataKey="publications"
										fill="#3B82F6"
										radius={[4, 4, 0, 0]}
									/>
								</BarChart>
							</ResponsiveContainer>
						</div>
					</SectionCard>
				</div>

				{/* Citation Analysis */}
				<SectionCard title={t("citationAnalysis")} icon={BsGraphUp}>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
						<div className="text-center p-6 rounded-xl bg-purple-500/10">
							<div className="text-3xl font-bold text-purple-600 dark:text-purple-400 mb-2">
								{stats.citationStats.hIndex}
							</div>
							<div className="text-sm text-black/60 dark:text-white/60">
								H-Index
							</div>
						</div>
					</div>
				</SectionCard>

				{/* International Collaboration */}
				<SectionCard title={t("internationalCollaboration")} icon={BsShare}>
					<div className="space-y-8">
						{/* Explanation */}
						<motion.div variants={itemVariants} className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/30 rounded-xl p-4">
							<h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2 flex items-center gap-2">
								<BsInfo className="w-4 h-4" />
								{t("understandingCollaborationTypes")}
							</h4>
							<div className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
															<div><strong>{t("international")}:</strong> {t("internationalCollabDescription", { country: stats.collaborationStats.baseCountry.countryName })}</div>
							<div><strong>{t("independent")}:</strong> {t("independentCollabDescription", { country: stats.collaborationStats.baseCountry.countryName })}</div>
							<div><strong>{t("domestic")}:</strong> {t("domesticCollabDescription")}</div>
								<div className="text-xs text-blue-600 dark:text-blue-300 mt-2 italic">
									{t("independentRatesNote")}
								</div>
							</div>
						</motion.div>
						{/* Overview Stats */}
						<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
							<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20">
								<div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-2">
									{stats.collaborationStats.overallCollaborationRate}%
								</div>
								<div className="text-sm font-medium text-black/60 dark:text-white/60">
									{t("overallCollaborationRate")}
								</div>
								<div className="text-xs text-black/40 dark:text-white/40 mt-1">
									{t("collaborativeItemsCount", { 
								collaborative: stats.collaborationStats.collaborativeItems.toLocaleString(),
								total: stats.collaborationStats.totalItems.toLocaleString()
							})}
								</div>
							</motion.div>
							<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20">
								<div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 mb-2">
									{stats.collaborationStats.baseCountry.collaborationRate}%
								</div>
								<div className="text-sm font-medium text-black/60 dark:text-white/60 flex items-center justify-center gap-2">
									<CountryFlag countryCode={stats.collaborationStats.baseCountry.countryCode} className="w-4 h-3" />
									{stats.collaborationStats.baseCountry.countryName || t("unknownCountry")}
								</div>
								<div className="text-xs text-black/40 dark:text-white/40 mt-1">
									{t("collaborativeItemsCount", { 
								collaborative: stats.collaborationStats.baseCountry.collaborativeItems.toLocaleString(),
								total: stats.collaborationStats.baseCountry.totalItems.toLocaleString()
							})}
								</div>
							</motion.div>
							<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20">
								<div className="text-3xl font-bold text-amber-600 dark:text-amber-400 mb-2">
									{stats.collaborationStats.countryCollaborationRates.filter(c => c.internationalItems > 0).length}
								</div>
								<div className="text-sm font-medium text-black/60 dark:text-white/60">
									{t("countriesWithInternationalCollaborations")}
								</div>
								<div className="text-xs text-black/40 dark:text-white/40 mt-1">
									{t("ofTotalCountries", { count: stats.collaborationStats.countryCollaborationRates.length })}
								</div>
							</motion.div>
						</div>

						{/* Charts Section */}
						<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
							{/* Collaboration Rates Chart */}
							<motion.div variants={itemVariants} className="space-y-4">
								<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
									<BsBarChart className="text-accent" />
									{t("countryCollaborationRates")}
								</h3>
								<Card color="card" className="p-6">
									<div className="h-96">
										<ResponsiveContainer width="100%" height="100%">
											<BarChart
												data={stats.collaborationStats.countryCollaborationRates.slice(0, 10).map((country) => ({
													country: country.countryName.length > 12 ? country.countryName.substring(0, 12) + "..." : country.countryName,
													fullName: country.countryName,
													countryCode: country.countryCode,
													international: country.internationalRate,
													independent: country.independentRate,
													domestic: country.domesticRate,
													totalItems: country.totalItems,
													internationalItems: country.internationalItems,
													independentItems: country.independentItems,
													domesticItems: country.domesticItems,
													isBaseCountry: country.countryCode === stats.collaborationStats.baseCountry.countryCode,
												}))}
												margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
											>
												<CartesianGrid strokeDasharray="3 3" className="stroke-black/10 dark:stroke-white/10" />
												<XAxis
													dataKey="country"
													className="text-black/60 dark:text-white/60"
													tick={{ fontSize: 11 }}
													axisLine={false}
													angle={-45}
													textAnchor="end"
													height={80}
												/>
												<YAxis
													className="text-black/60 dark:text-white/60"
													tick={{ fontSize: 12 }}
													axisLine={false}
													tickFormatter={(value) => `${value}%`}
												/>
												<Tooltip
													contentStyle={{
														backgroundColor: theme === "dark" ? "#1a1a1a" : "#ffffff",
														border: `1px solid ${theme === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"}`,
														borderRadius: "12px",
														boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
														padding: "12px",
													}}
													content={({ active, payload, label }) => {
														if (!active || !payload || !payload.length) return null;
														const data = payload[0].payload;
														return (
															<div className="space-y-1" style={{
																backgroundColor: theme === "dark" ? "#1a1a1a" : "#ffffff",
																border: `1px solid ${theme === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)"}`,
																borderRadius: "12px",
																boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
																padding: "12px",
															}}>
																<div className="flex items-center gap-2 mb-2">
																	<CountryFlag countryCode={data.countryCode} className="w-4 h-3" />
																															<span className="font-medium" style={{ color: theme === "dark" ? "#ffffff" : "#000000" }}>
															{data.fullName || t("unknownCountry")}
														</span>
																</div>
																<div className="text-sm space-y-1">
																	<div style={{ color: theme === "dark" ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.8)" }}>
																		{t("international")}: <span className="font-medium text-blue-600 dark:text-blue-400">{data.international}%</span>
																	</div>
																	<div style={{ color: theme === "dark" ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.8)" }}>
																		{t("independent")}: <span className="font-medium text-emerald-600 dark:text-emerald-400">{data.independent}%</span>
																	</div>
																	<div style={{ color: theme === "dark" ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.8)" }}>
																		{t("domestic")}: <span className="font-medium text-amber-600 dark:text-amber-400">{data.domestic}%</span>
																	</div>
																	<div style={{ color: theme === "dark" ? "rgba(255, 255, 255, 0.8)" : "rgba(0, 0, 0, 0.8)" }}>
																		{t("totalItemsCount", { count: data.totalItems.toLocaleString() })}
																	</div>
																	<div style={{ color: theme === "dark" ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.6)" }} className="text-xs">
																		<div>{t("international")}: {t("internationalTooltip")}</div>
																		<div>{t("independent")}: {t("independentTooltip")}</div>
																		<div>{t("domestic")}: {t("domesticTooltip")}</div>
																	</div>
																</div>
															</div>
														);
													}}
												/>
																				<Bar dataKey="international" fill="#3B82F6" radius={[4, 4, 0, 0]} name={t("internationalInclBase")} />
								<Bar dataKey="independent" fill="#10B981" radius={[4, 4, 0, 0]} name={t("independentExclBase")} />
								<Bar dataKey="domestic" fill="#F59E0B" radius={[4, 4, 0, 0]} name={t("domesticNoIntl")} />
											</BarChart>
										</ResponsiveContainer>
									</div>
								</Card>
							</motion.div>

							{/* Top Collaborations */}
							<motion.div variants={itemVariants} className="space-y-4">
								<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
									<BsDiagram3 className="text-accent" />
									{t("topCountryPairs")}
								</h3>
								<Card color="card" className="p-6">
									<div className="space-y-4 h-96 overflow-y-auto">
										{stats.collaborationStats.topCollaborations.map((collab, index) => (
											<motion.div
												key={index}
												variants={itemVariants}
												className="p-4 rounded-xl bg-gradient-to-r from-black/5 to-transparent dark:from-white/5 border border-black/10 dark:border-white/10 hover:border-accent/30 transition-all duration-300"
											>
												<div className="flex items-start justify-between gap-3">
													<div className="flex items-center gap-2 flex-shrink-0">
														<div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${index < 3
																? "bg-gradient-to-r from-amber-400 to-amber-600 text-white"
																: "bg-black/10 dark:bg-white/10 text-black/60 dark:text-white/60"
															}`}>
															{index + 1}
														</div>
													</div>
													<div className="flex-1 min-w-0">
														<div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
															<div className="flex items-center gap-2 min-w-0">
																<CountryFlag countryCode={collab.country1} className="w-5 h-3 flex-shrink-0" />
																<span className="text-sm font-medium truncate">
																	{(collab.country1Name || collab.country1 || t("unknown")).length > 15
																		? (collab.country1Name || collab.country1 || t("unknown")).substring(0, 15) + "..."
																		: (collab.country1Name || collab.country1 || t("unknown"))
																	}
																</span>
															</div>
															<div className="flex items-center justify-center flex-shrink-0">
																<span className="text-black/40 dark:text-white/40 text-sm">↔</span>
															</div>
															<div className="flex items-center gap-2 min-w-0">
																<CountryFlag countryCode={collab.country2} className="w-5 h-3 flex-shrink-0" />
																<span className="text-sm font-medium truncate">
																	{(collab.country2Name || collab.country2 || t("unknown")).length > 15
																		? (collab.country2Name || collab.country2 || t("unknown")).substring(0, 15) + "..."
																		: (collab.country2Name || collab.country2 || t("unknown"))
																	}
																</span>
															</div>
														</div>
													</div>
													<div className="text-right flex-shrink-0">
														<div className="text-lg font-bold text-accent">
															{collab.collaborationCount}
														</div>
														<div className="text-xs text-black/60 dark:text-white/60">
															{t("collaborations")}
														</div>
													</div>
												</div>
											</motion.div>
										))}
									</div>
								</Card>
							</motion.div>
						</div>

						{/* Detailed Collaboration Table */}
						<motion.div variants={itemVariants} className="space-y-4">
							<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
								<BsFlag className="text-accent" />
								{t("countryCollaborationDetails")}
							</h3>
							<Table
								color="statistics"
								aria-label={t("countryCollaborationRatesTable")}
								sortDescriptor={collaborationSortDescriptor}
								onSortChange={(descriptor: any) => setCollaborationSortDescriptor(descriptor)}
							>
								<TableHeader>
									<TableColumn key="countryName" allowsSorting>{t("countryColumn")}</TableColumn>
									<TableColumn key="totalItems" allowsSorting>{t("totalItems")}</TableColumn>
									<TableColumn key="internationalItems" allowsSorting>{t("international")}</TableColumn>
									<TableColumn key="internationalRate" allowsSorting>{t("internationalPercent")}</TableColumn>
									<TableColumn key="independentItems" allowsSorting>{t("independent")}</TableColumn>
									<TableColumn key="independentRate" allowsSorting>{t("independentPercent")}</TableColumn>
									<TableColumn key="domesticItems" allowsSorting>{t("domestic")}</TableColumn>
									<TableColumn key="domesticRate" allowsSorting>{t("domesticPercent")}</TableColumn>
								</TableHeader>
								<TableBody>
									{paginatedCollaborationCountries.map((country, index) => (
										<TableRow key={index}>
											<TableCell>
												<div className="flex items-center gap-3">
													<CountryFlag countryCode={country.countryCode} />
													<div>
														<div className="font-medium">{country.countryName || country.countryCode || t("unknownCountry")}</div>
														{country.countryCode && (
															<div className="text-xs text-black/60 dark:text-white/60">{country.countryCode}</div>
														)}
													</div>
												</div>
											</TableCell>
											<TableCell>
												<span className="font-bold text-accent">{country.totalItems.toLocaleString()}</span>
											</TableCell>
											<TableCell>
												<span className="font-bold text-blue-600 dark:text-blue-400">{country.internationalItems.toLocaleString()}</span>
											</TableCell>
											<TableCell>
												<span className="font-bold text-blue-600 dark:text-blue-400">{country.internationalRate}%</span>
											</TableCell>
											<TableCell>
												<span className="font-bold text-emerald-600 dark:text-emerald-400">{country.independentItems.toLocaleString()}</span>
											</TableCell>
											<TableCell>
												<span className="font-bold text-emerald-600 dark:text-emerald-400">{country.independentRate}%</span>
											</TableCell>
											<TableCell>
												<span className="font-bold text-amber-600 dark:text-amber-400">{country.domesticItems.toLocaleString()}</span>
											</TableCell>
											<TableCell>
												<span className="font-bold text-amber-600 dark:text-amber-400">{country.domesticRate}%</span>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
							{collaborationPages > 1 && (
								<div className="flex justify-center mt-4">
									<Pagination
										total={collaborationPages}
										page={countriesPage}
										onChange={setCountriesPage}
										showControls
										size="sm"
									/>
								</div>
							)}
						</motion.div>
					</div>
				</SectionCard>

				{/* Institutions Table */}
				<SectionCard title={t("allInstitutions")} icon={BsBuilding}>
					<div className="space-y-4">
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
							<Select
								label={t("filterByYear")}
								placeholder={t("selectYear")}
								placement="left"
								selectedKeys={[selectedYear]}
								onSelectionChange={(keys) => {
									const selected = Array.from(
										keys
									)[0] as string;
									setSelectedYear(selected || "all");
								}}
								classNames={{
									base: "flex-1 max-w-full",
									trigger: "h-full",
								}}
								items={[
									{ key: "all", name: t("allYears") },
									...stats.availableYears.map((year) => ({
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
						</div>
						<Card color="card">
							{topCountry && (
								<div className="flex items-center gap-2 mb-2">
									<CountryFlag countryCode={topCountry.countryCode} className="w-5 h-3" />
									<span className="text-sm font-medium text-black dark:text-white">
										{topCountry.countryName || topCountry.countryCode || t("unknownCountry")} (
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
									{topCountry?.countryName || t("topCountry")}{" "}
								</span>
							</Switch>
						</Card>
						<Table
							color="statistics"
							aria-label={t("institutionsTableAriaLabel")}
							sortDescriptor={institutionsSortDescriptor}
							onSortChange={(descriptor: any) => setInstitutionsSortDescriptor(descriptor)}
						>
							<TableHeader>
								<TableColumn key="institution" allowsSorting>
									{t("institutionColumn")}
								</TableColumn>
								<TableColumn key="countryCode" allowsSorting>{t("countryColumn")}</TableColumn>
								<TableColumn key="itemCount" allowsSorting>{t("itemsColumn")}</TableColumn>
								<TableColumn key="totalCitations" allowsSorting>
									{t("citationsColumn")}
								</TableColumn>
								<TableColumn key="avgCitationsPerItem" allowsSorting>
									{t("avgPerItemColumn")}
								</TableColumn>
								<TableColumn key="hIndex" allowsSorting>H-Index</TableColumn>
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
													<CountryFlag countryCode={institution.countryCode} />
													<span className="text-sm font-medium">
														{institution.countryCode || t("unknown")}
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
											<TableCell>
												<span className="font-bold text-purple-600 dark:text-purple-400">
													{institution.hIndex}
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
					<div className="space-y-8">
						{/* Hero Stats Row */}
						<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
							<motion.div
								variants={itemVariants}
								className="text-center p-6 rounded-2xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20"
							>
								<div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-2">
									{stats.authorCountries.length}
								</div>
								<div className="text-sm font-medium text-black/60 dark:text-white/60">
									{t("totalCountries")}
								</div>
							</motion.div>
							<motion.div
								variants={itemVariants}
								className="text-center p-6 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20"
							>
								<div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 mb-2">
									{stats.creatorStats.uniqueCreators.toLocaleString()}
								</div>
								<div className="text-sm font-medium text-black/60 dark:text-white/60">
									{t("totalAuthors")}
								</div>
							</motion.div>
							<motion.div
								variants={itemVariants}
								className="text-center p-6 rounded-2xl bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20"
							>
								<div className="text-3xl font-bold text-amber-600 dark:text-amber-400 mb-2">
									{(
										stats.creatorStats.uniqueCreators /
										stats.authorCountries.length
									).toFixed(1)}
								</div>
								<div className="text-sm font-medium text-black/60 dark:text-white/60">
									{t("avgAuthorsPerCountry")}
								</div>
							</motion.div>
							<motion.div
								variants={itemVariants}
								className="text-center p-6 rounded-2xl bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20"
							>
								<div className="text-3xl font-bold text-purple-600 dark:text-purple-400 mb-2">
									{Math.max(
										...stats.authorCountries.map(
											(c) => c.hIndex
										)
									)}
								</div>
								<div className="text-sm font-medium text-black/60 dark:text-white/60">
									{t("maxHIndex")}
								</div>
							</motion.div>
						</div>

						{/* Charts Section */}
						<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
							{/* Authors vs Items Combined Chart */}
							<motion.div
								variants={itemVariants}
								className="space-y-4"
							>
								<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
									<BsBarChart className="text-accent" />
									{t("authorsVsItems")}
								</h3>
								<Card color="card" className="p-6">
									<div className="h-96">
										<ResponsiveContainer
											width="100%"
											height="100%"
										>
											<BarChart
												data={stats.authorCountries
													.slice(0, 8)
													.map((country) => ({
														country:
															country.countryName
																.length > 10
																? country.countryName.substring(
																	0,
																	10
																) + "..."
																: country.countryName,
														fullName:
															country.countryName,
														authors:
															country.authorCount,
														items: country.itemCount,
														hIndex: country.hIndex,
														countryCode:
															country.countryCode,
														productivity: (
															country.itemCount /
															country.authorCount
														).toFixed(1),
													}))}
												margin={{
													top: 0,
													right: 0,
													left: 0,
													bottom: 0,
												}}
											>
												<CartesianGrid
													strokeDasharray="3 3"
													className="stroke-black/10 dark:stroke-white/10"
												/>
												<XAxis
													dataKey="country"
													className="text-black/60 dark:text-white/60"
													tick={{ fontSize: 11 }}
													axisLine={false}
													angle={-45}
													textAnchor="end"
													height={80}
												/>
												<YAxis
													className="text-black/60 dark:text-white/60"
													tick={{ fontSize: 12 }}
													axisLine={false}
													tickFormatter={(value) =>
														value.toLocaleString()
													}
												/>
												<Tooltip
													contentStyle={{
														backgroundColor:
															theme === "dark"
																? "#1a1a1a"
																: "#ffffff",
														border: `1px solid ${theme === "dark"
																? "rgba(255, 255, 255, 0.1)"
																: "rgba(0, 0, 0, 0.1)"
															}`,
														borderRadius: "12px",
														boxShadow:
															"0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
														padding: "12px",
													}}
													labelStyle={{
														color:
															theme === "dark"
																? "#ffffff"
																: "#000000",
														fontWeight: "600",
														marginBottom: "8px",
													}}
													itemStyle={{
														color:
															theme === "dark"
																? "rgba(255, 255, 255, 0.8)"
																: "rgba(0, 0, 0, 0.8)",
														fontSize: "13px",
													}}
													content={({ active, payload, label }) => {
														if (!active || !payload || !payload.length) return null;

														const data = payload[0].payload;

														return (
															<div
																className="space-y-1"
																style={{
																	backgroundColor:
																		theme === "dark"
																			? "#1a1a1a"
																			: "#ffffff",
																	border: `1px solid ${theme === "dark"
																			? "rgba(255, 255, 255, 0.1)"
																			: "rgba(0, 0, 0, 0.1)"
																		}`,
																	borderRadius: "12px",
																	boxShadow:
																		"0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
																	padding: "12px",
																}}
															>
																<div className="flex items-center gap-2 mb-2">
																	<CountryFlag countryCode={data.countryCode} className="w-4 h-3" />
																	<span
																		className="font-medium"
																		style={{
																			color:
																				theme === "dark"
																					? "#ffffff"
																					: "#000000",
																		}}
																	>
																		{data.fullName || t("unknownCountry")}
																	</span>
																</div>
																<div className="text-sm space-y-1">
																	<div
																		style={{
																			color:
																				theme === "dark"
																					? "rgba(255, 255, 255, 0.8)"
																					: "rgba(0, 0, 0, 0.8)",
																		}}
																	>
																		<span className="font-medium text-emerald-600 dark:text-emerald-400">
																			{data.authors.toLocaleString()}
																		</span>{" "}
																		{t("authorsLabel").toLowerCase()}
																	</div>
																	<div
																		style={{
																			color:
																				theme === "dark"
																					? "rgba(255, 255, 255, 0.8)"
																					: "rgba(0, 0, 0, 0.8)",
																		}}
																	>
																		<span className="font-medium text-blue-600 dark:text-blue-400">
																			{data.items.toLocaleString()}
																		</span>{" "}
																		{t("itemsLowercase")}
																	</div>
																	<div
																		style={{
																			color:
																				theme === "dark"
																					? "rgba(255, 255, 255, 0.8)"
																					: "rgba(0, 0, 0, 0.8)",
																		}}
																	>
																		{t("productivity")}:{" "}
																		<span className="font-medium text-amber-600 dark:text-amber-400">
																			{data.productivity}
																		</span>{" "}
																		{t("itemsPerAuthor")}
																	</div>
																	<div
																		style={{
																			color:
																				theme === "dark"
																					? "rgba(255, 255, 255, 0.8)"
																					: "rgba(0, 0, 0, 0.8)",
																		}}
																	>
																		H-Index:{" "}
																		<span className="font-medium text-purple-600 dark:text-purple-400">
																			{data.hIndex}
																		</span>
																	</div>
																</div>
															</div>
														);
													}}
												/>
												<Bar
													dataKey="authors"
													fill="#10B981"
													radius={[4, 4, 0, 0]}
													name="authors"
												/>
												<Bar
													dataKey="items"
													fill="#3B82F6"
													radius={[4, 4, 0, 0]}
													name="items"
												/>
											</BarChart>
										</ResponsiveContainer>
									</div>
								</Card>
							</motion.div>

							{/* H-Index Distribution Pie Chart */}
							<motion.div
								variants={itemVariants}
								className="space-y-4"
							>
								<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
									<BsGraphUp className="text-accent" />
									H-Index {t("distribution")} -{" "}
									{t("topCountries")}
								</h3>
								<Card color="card" className="p-6">
									<div className="h-96">
										<ResponsiveContainer
											width="100%"
											height="100%"
										>
											<PieChart>
												<Pie
													data={stats.authorCountries
														.slice(0, 8)
														.map((country, index) => ({
															name: country.countryName,
															value: country.hIndex,
															itemCount:
																country.itemCount,
															authorCount:
																country.authorCount,
															countryCode:
																country.countryCode,
															color: pieColors[
																index %
																pieColors.length
															],
														}))}
													cx="50%"
													cy="50%"
													innerRadius={80}
													outerRadius={140}
													paddingAngle={2}
													dataKey="value"
													stroke={
														theme === "dark"
															? "rgba(255, 255, 255, 0.1)"
															: "rgba(0, 0, 0, 0.1)"
													}
													strokeWidth={1}
												>
													{stats.authorCountries
														.slice(0, 8)
														.map((entry, index) => (
															<Cell
																key={`cell-${index}`}
																fill={
																	pieColors[
																	index %
																	pieColors.length
																	]
																}
																stroke={
																	theme === "dark"
																		? "rgba(255, 255, 255, 0.1)"
																		: "rgba(0, 0, 0, 0.1)"
																}
																strokeWidth={1}
															/>
														))}
												</Pie>
												<Tooltip
													content={({ active, payload }) => {
														if (!active || !payload || !payload.length) return null;

														const data = payload[0].payload;

														return (
															<div
																className="space-y-2"
																style={{
																	backgroundColor:
																		theme === "dark"
																			? "#1a1a1a"
																			: "#ffffff",
																	border: `1px solid ${theme === "dark"
																			? "rgba(255, 255, 255, 0.1)"
																			: "rgba(0, 0, 0, 0.1)"
																		}`,
																	borderRadius: "12px",
																	boxShadow:
																		theme === "dark"
																			? "0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)"
																			: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
																	padding: "12px",
																}}
															>
																<div className="flex items-center gap-2">
																	<CountryFlag countryCode={data.countryCode} className="w-4 h-3" />
																	<span
																		className="font-medium"
																		style={{
																			color:
																				theme === "dark"
																					? "#ffffff"
																					: "#000000",
																		}}
																	>
																		{data.name || t("unknownCountry")}
																	</span>
																</div>
																<div className="text-sm space-y-1">
																	<div
																		style={{
																			color:
																				theme === "dark"
																					? "rgba(255, 255, 255, 0.8)"
																					: "rgba(0, 0, 0, 0.8)",
																		}}
																	>
																		H-Index:{" "}
																		<span className="font-bold text-purple-600 dark:text-purple-400">
																			{data.value}
																		</span>
																	</div>
																	<div
																		style={{
																			color:
																				theme === "dark"
																					? "rgba(255, 255, 255, 0.8)"
																					: "rgba(0, 0, 0, 0.8)",
																		}}
																	>
																		<span className="font-medium text-blue-600 dark:text-blue-400">
																			{data.itemCount.toLocaleString()}
																		</span>{" "}
																		{t("itemsLowercase")}
																	</div>
																	<div
																		style={{
																			color:
																				theme === "dark"
																					? "rgba(255, 255, 255, 0.8)"
																					: "rgba(0, 0, 0, 0.8)",
																		}}
																	>
																		<span className="font-medium text-emerald-600 dark:text-emerald-400">
																			{data.authorCount.toLocaleString()}
																		</span>{" "}
																		{t("authorsLabel").toLowerCase()}
																	</div>
																</div>
															</div>
														);
													}}
												/>
												<Legend
													verticalAlign="bottom"
													height={36}
													iconType="circle"
													wrapperStyle={{
														paddingTop: "20px",
														fontSize: "12px",
														color:
															theme === "dark"
																? "rgba(255, 255, 255, 0.8)"
																: "rgba(0, 0, 0, 0.8)",
													}}
													formatter={(
														value: string,
														entry: any
													) => (
														<span
															style={{
																color:
																	theme === "dark"
																		? "rgba(255, 255, 255, 0.8)"
																		: "rgba(0, 0, 0, 0.8)",
																fontSize: "12px",
															}}
														>
															{value.length > 15
																? value.substring(
																	0,
																	15
																) + "..."
																: value}
														</span>
													)}
												/>
											</PieChart>
										</ResponsiveContainer>
									</div>
								</Card>
							</motion.div>
						</div>

						{/* Top Countries Leaderboard */}
						<motion.div
							variants={itemVariants}
							className="space-y-4"
						>
							<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
								<BsFlag className="text-accent" />
								{t("topCountriesLeaderboard")}
							</h3>
							<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
								{stats.authorCountries
									.slice(0, 12)
									.map((country, index) => (
										<motion.div
											key={index}
											variants={itemVariants}
											className="relative p-4 rounded-xl bg-gradient-to-r from-black/5 to-transparent dark:from-white/5 border border-black/10 dark:border-white/10 hover:border-accent/30 transition-all duration-300 hover:scale-[1.02] group"
										>
											<div className="flex items-center gap-3">
												<div className="flex items-center gap-2 flex-shrink-0">
													<div
														className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${index < 3
																? "bg-gradient-to-r from-amber-400 to-amber-600 text-white"
																: "bg-black/10 dark:bg-white/10 text-black/60 dark:text-white/60"
															}`}
													>
														{index + 1}
													</div>
													<CountryFlag countryCode={country.countryCode} />
												</div>
												<div className="flex-1 min-w-0">
													<div className="font-semibold text-black dark:text-white text-sm truncate group-hover:text-accent transition-colors">
														{country.countryName}
													</div>
													<div className="text-xs text-black/60 dark:text-white/60 space-x-2">
														<span className="text-blue-600 dark:text-blue-400 font-medium">
															{country.itemCount.toLocaleString()}
														</span>
														<span>•</span>
														<span className="text-emerald-600 dark:text-emerald-400 font-medium">
															{country.authorCount.toLocaleString()}
														</span>
														<span>•</span>
														<span className="text-purple-600 dark:text-purple-400 font-medium">
															H:{country.hIndex}
														</span>
													</div>
												</div>
												<div className="text-right flex-shrink-0">
													<div className="text-sm font-bold text-accent">
														{(
															country.itemCount /
															country.authorCount
														).toFixed(1)}
													</div>
																									<div className="text-xs text-black/40 dark:text-white/40">
													{t("perAuthor")}
												</div>
												</div>
											</div>
										</motion.div>
									))}
							</div>
						</motion.div>
					</div>
				</SectionCard>

				{/* Author Countries Table */}
				<SectionCard title={t("authorCountriesTable")} icon={BsFlag}>
					<div className="space-y-4">
						<Table
							color="statistics"
							aria-label={t("coAuthorCountriesStatsAriaLabel")}
							sortDescriptor={countriesSortDescriptor}
							onSortChange={(descriptor: any) => setCountriesSortDescriptor(descriptor)}
						>
							<TableHeader>
								<TableColumn key="countryName" allowsSorting>
									{t("countryColumn")}
								</TableColumn>
								<TableColumn key="authorCount" allowsSorting>
									{t("uniqueAuthorsColumn")}
								</TableColumn>
								<TableColumn key="itemCount" allowsSorting>
									{t("itemsColumn")}
								</TableColumn>
								<TableColumn key="avgItems" allowsSorting>
									{t("avgItemsPerAuthorColumn")}
								</TableColumn>
								<TableColumn key="hIndex" allowsSorting>
									H-Index
								</TableColumn>
							</TableHeader>
							<TableBody items={paginatedCountries}>
								{(country) => (
									<TableRow key={country.countryCode}>
										<TableCell>
											<div className="flex items-center gap-3">
												<CountryFlag countryCode={country.countryCode} />
												<div>
													<div className="font-medium">
														{country.countryName || country.countryCode || t("unknownCountry")}
													</div>
													{country.countryCode && (
														<div className="text-xs text-black/60 dark:text-white/60">
															{country.countryCode}
														</div>
													)}
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
										<TableCell>
											<div className="font-medium text-purple-600 dark:text-purple-400">
												{country.hIndex}
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

				{/* Author Analytics */}
				<SectionCard title={t("authorAnalytics")} icon={BsPeople}>
					<div className="space-y-8">
						{/* Author Overview Stats */}
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
							<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20">
								<div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-2">
									{stats.authorProductivityStats.totalAuthors.toLocaleString()}
								</div>
								<div className="text-sm font-medium text-black/60 dark:text-white/60">
									{t("totalAuthors")}
								</div>
								<div className="text-xs text-black/40 dark:text-white/40 mt-1">
									{t("allUniqueResearchers")}
								</div>
							</motion.div>
							<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20">
								<div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 mb-2">
									{stats.authorProductivityStats.authorsWithMultipleWorks.toLocaleString()}
								</div>
								<div className="text-sm font-medium text-black/60 dark:text-white/60">
									{t("prolificAuthors")}
								</div>
								<div className="text-xs text-black/40 dark:text-white/40 mt-1">
									{t("multiplePublications")}
								</div>
							</motion.div>
							<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20">
								<div className="text-3xl font-bold text-amber-600 dark:text-amber-400 mb-2">
									{stats.authorCollaborationStats.collaborationRate}%
								</div>
								<div className="text-sm font-medium text-black/60 dark:text-white/60">
									{t("collaborationRate")}
								</div>
								<div className="text-xs text-black/40 dark:text-white/40 mt-1">
									{t("authorsWhoCollaborate")}
								</div>
							</motion.div>
							<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20">
								<div className="text-3xl font-bold text-purple-600 dark:text-purple-400 mb-2">
									{stats.authorProductivityStats.avgItemsPerAuthor}
								</div>
								<div className="text-sm font-medium text-black/60 dark:text-white/60">
									{t("avgPerAuthor")}
								</div>
								<div className="text-xs text-black/40 dark:text-white/40 mt-1">
									{t("publicationsPerResearcher")}
								</div>
							</motion.div>
						</div>

						{/* Charts Section */}
						<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
							{/* REAL Author Productivity Distribution */}
							<motion.div variants={itemVariants} className="space-y-4">
								<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
									<BsBarChart className="text-accent" />
																						{t("globalAuthorProductivityDistribution")}
								</h3>
								<Card color="card" className="p-6">
									<div className="h-96">
										<ResponsiveContainer width="100%" height="100%">
											<BarChart
												data={stats.authorProductivityStats.productivityDistribution}
												margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
											>
												<CartesianGrid strokeDasharray="3 3" className="stroke-black/10 dark:stroke-white/10" />
												<XAxis
													dataKey="range"
													className="text-black/60 dark:text-white/60"
													tick={{ fontSize: 11 }}
													axisLine={false}
													angle={-45}
													textAnchor="end"
													height={80}
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
														`${value.toLocaleString()} ${t("authorsLowercase")} (${props.payload.percentage}%)`,
														t("count")
													]}
												/>
												<Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} />
											</BarChart>
										</ResponsiveContainer>
									</div>
								</Card>
							</motion.div>

							{/* Top Authors by H-Index */}
							<motion.div variants={itemVariants} className="space-y-4">
								<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
									<BsGraphUp className="text-accent" />
									{t("topResearchers", { count: stats.authorStats.length })}
								</h3>
								<Card color="card" className="p-6">
									<div className="space-y-4 h-96 overflow-y-auto">
										{stats.authorStats.slice(0, 20).map((author, index) => (
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
													<div className="flex-1 min-w-0">
														<div className="font-semibold text-black dark:text-white text-sm truncate">
															{author.displayName || t("unknownAuthor")}
														</div>
														<div className="text-xs text-black/60 dark:text-white/60 space-x-2">
															<span className="text-blue-600 dark:text-blue-400 font-medium">
																{author.itemCount.toLocaleString()} {t("itemsLowercase")}
															</span>
															<span>•</span>
															<span className="text-emerald-600 dark:text-emerald-400 font-medium">
																{author.totalCitations.toLocaleString()} {t("citationsLowercase")}
															</span>
															<span>•</span>
															<span className="text-amber-600 dark:text-amber-400 font-medium">
																{author.countryCount} {t("countriesLowercase")}
															</span>
														</div>
													</div>
												</div>
												<div className="text-right flex-shrink-0">
													<div className="text-lg font-bold text-purple-600 dark:text-purple-400">
														{author.hIndex}
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

						{/* Author Statistics Table */}
						<motion.div variants={itemVariants} className="space-y-4">
							<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
								<BsPeople className="text-accent" />
								{t("detailedAuthorStatistics", { count: stats.authorStats.length })}
							</h3>
							<div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/30 rounded-xl p-4 mb-4">
								<div className="text-sm text-blue-800 dark:text-blue-200">
									<strong>{t("note")}:</strong> {t("authorTableNote", { count: stats.authorStats.length })}
									{t("globalStatsNote", { total: stats.authorProductivityStats.totalAuthors.toLocaleString() })}
								</div>
							</div>
							<div className="space-y-4">
								<Input
									label={t("searchAuthors")}
									value={authorsSearch}
									onChange={(e) => setAuthorsSearch(e.target.value)}
									placeholder={t("searchByAuthorName")}
									startContent={<BsSearch className="text-black/40 dark:text-white/40" />}
								/>
								<Table
									color="statistics"
									aria-label={t("authorStatisticsTable")}
									sortDescriptor={authorsSortDescriptor}
									onSortChange={(descriptor: any) => setAuthorsSortDescriptor(descriptor)}
								>
									<TableHeader>
																		<TableColumn key="displayName" allowsSorting>{t("authorColumn")}</TableColumn>
								<TableColumn key="itemCount" allowsSorting>{t("itemsColumn")}</TableColumn>
								<TableColumn key="totalCitations" allowsSorting>{t("citationsColumn")}</TableColumn>
								<TableColumn key="avgCitationsPerItem" allowsSorting>{t("avgPerItemColumn")}</TableColumn>
								<TableColumn key="hIndex" allowsSorting>H-Index</TableColumn>
								<TableColumn key="countryCount" allowsSorting>{t("countriesColumn")}</TableColumn>
								<TableColumn key="yearSpan" allowsSorting>{t("activeYearsColumn")}</TableColumn>
									</TableHeader>
									<TableBody>
										{paginatedAuthors.map((author, index) => (
											<TableRow key={index}>
												<TableCell>
													<div>
																									<div className="font-medium">
												{author.displayName || t("unknownAuthor")}
											</div>
														<div className="text-xs text-black/60 dark:text-white/60">
															{author.mostCommonCreatorType}
														</div>
													</div>
												</TableCell>
												<TableCell>
													<span className="font-bold text-accent">
														{author.itemCount.toLocaleString()}
													</span>
												</TableCell>
												<TableCell>
													<span className="font-bold text-success">
														{author.totalCitations.toLocaleString()}
													</span>
												</TableCell>
												<TableCell>
													<span className="font-bold text-tertiary">
														{author.avgCitationsPerItem.toFixed(1)}
													</span>
												</TableCell>
												<TableCell>
													<span className="font-bold text-purple-600 dark:text-purple-400">
														{author.hIndex}
													</span>
												</TableCell>
												<TableCell>
													<span className="font-bold text-emerald-600 dark:text-emerald-400">
														{author.countryCount}
													</span>
												</TableCell>
												<TableCell>
													<span className="font-bold text-amber-600 dark:text-amber-400">
														{author.firstPublicationYear === author.lastPublicationYear
															? author.firstPublicationYear
															: `${author.firstPublicationYear}-${author.lastPublicationYear}`
														}
													</span>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
								{authorsPages > 1 && (
									<div className="flex justify-center">
										<Pagination
											total={authorsPages}
											page={authorsPage}
											onChange={setAuthorsPage}
											showControls
											size="sm"
										/>
									</div>
								)}
							</div>
						</motion.div>
					</div>
				</SectionCard>

				{/* Research Topics Analysis */}
				<SectionCard title={t("researchTopics")} icon={BsTags}>
					<div className="space-y-8">
						{/* Topic Overview Stats */}
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
							<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20">
								<div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-2">
									{stats.topicOverview.totalTopics.toLocaleString()}
								</div>
								<div className="text-sm font-medium text-black/60 dark:text-white/60">
									{t("totalTopics")}
								</div>
								<div className="text-xs text-black/40 dark:text-white/40 mt-1">
									{t("allHierarchicalLevels")}
								</div>
							</motion.div>
							<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20">
								<div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 mb-2">
									{stats.topicOverview.topLevelTopics.toLocaleString()}
								</div>
								<div className="text-sm font-medium text-black/60 dark:text-white/60">
									{t("topLevelTopics")}
								</div>
								<div className="text-xs text-black/40 dark:text-white/40 mt-1">
									{t("mainResearchAreas")}
								</div>
							</motion.div>
							<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20">
								<div className="text-3xl font-bold text-amber-600 dark:text-amber-400 mb-2">
									{stats.topicOverview.maxDepth}
								</div>
								<div className="text-sm font-medium text-black/60 dark:text-white/60">
									{t("maxDepth")}
								</div>
								<div className="text-xs text-black/40 dark:text-white/40 mt-1">
									{t("hierarchicalLevels")}
								</div>
							</motion.div>
							<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/20">
								<div className="text-3xl font-bold text-purple-600 dark:text-purple-400 mb-2">
									{stats.topicOverview.avgItemsPerTopic}
								</div>
								<div className="text-sm font-medium text-black/60 dark:text-white/60">
									{t("avgItemsPerTopic")}
								</div>
								<div className="text-xs text-black/40 dark:text-white/40 mt-1">
									{t("publicationsPerTopic")}
								</div>
							</motion.div>
						</div>

						{/* Charts Section */}
						<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
							{/* Topic Distribution by Level */}
							<motion.div variants={itemVariants} className="space-y-4">
								<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
									<BsLayers className="text-accent" />
									{t("topicDistributionByLevel")}
								</h3>
								<Card color="card" className="p-6">
									<div className="h-96">
										<ResponsiveContainer width="100%" height="100%">
											<BarChart
												data={stats.topicOverview.topicDistribution}
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
									<BsGraphUp className="text-accent" />
									{t("topTopicsByImpact")}
								</h3>
								<Card color="card" className="p-6">
									<div className="space-y-4 h-96 overflow-y-auto">
										{stats.topicStats.slice(0, 20).map((topic, index) => (
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
								<BsBookmark className="text-accent" />
								{t("topLevelResearchAreas")}
							</h3>
							<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
								{stats.topicStats.filter(topic => topic.level === 1).slice(0, 12).map((topic, index) => (
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
								<BsTags className="text-accent" />
								{t("allResearchTopics")}
							</h3>
							<div className="space-y-4">
								<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
									<Input
										label={t("searchTopics")}
										value={topicsSearch}
										onChange={(e) => setTopicsSearch(e.target.value)}
										placeholder={t("searchByTopicNameOrPath")}
										startContent={<BsSearch className="text-black/40 dark:text-white/40" />}
									/>
									<Select
										label={t("filterByLevel")}
										placeholder={t("selectLevel")}
										placement="left"
										selectedKeys={[selectedTopicLevel]}
										onSelectionChange={(keys) => {
											const selected = Array.from(keys)[0] as string;
											setSelectedTopicLevel(selected || "all");
										}}
										classNames={{
											base: "flex-1 max-w-full",
											trigger: "h-full",
										}}
										items={[
											{ key: "all", name: t("allLevels") },
											...Array.from({ length: stats.topicOverview.maxDepth }, (_, i) => ({
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

				{/* Top Journals Table */}
				{stats.topJournals.length > 0 && (
					<SectionCard title={t("topJournals")} icon={BsJournalText}>
						<div className="space-y-4">
							<Table
								color="statistics"
								aria-label={t("topJournalsTableAriaLabel")}
								sortDescriptor={journalsSortDescriptor}
								onSortChange={(descriptor: any) => setJournalsSortDescriptor(descriptor)}
							>
								<TableHeader>
									<TableColumn key="journal" allowsSorting>
										{t("journalColumn")}
									</TableColumn>
									<TableColumn key="count" allowsSorting>
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
