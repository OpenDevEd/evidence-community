import { useMemo, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { BsPeople, BsBarChart, BsGraphUp, BsSearch } from "react-icons/bs";
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
import { Pagination } from "@/components/nextui/Pagination";
import { Card } from "@/components/nextui/Card";
import { SectionCard } from "./SectionCard";
import { AuthorStats, AuthorProductivityStats, AuthorCollaborationStats } from "./types";

type AuthorAnalyticsProps = {
	authorStats: AuthorStats[];
	authorProductivityStats: AuthorProductivityStats;
	authorCollaborationStats: AuthorCollaborationStats;
};

const itemVariants = {
	hidden: { y: 20, opacity: 0 },
	show: { y: 0, opacity: 1 },
};

export function AuthorAnalytics({ 
	authorStats, 
	authorProductivityStats, 
	authorCollaborationStats 
}: AuthorAnalyticsProps) {
	const t = useTranslations("ui");
	const { resolvedTheme: theme } = useTheme();
	const [authorsPage, setAuthorsPage] = useState(1);
	const [authorsSearch, setAuthorsSearch] = useState("");
	const [authorsSortDescriptor, setAuthorsSortDescriptor] = useState<{ column: string, direction: "ascending" | "descending" }>({
		column: "itemCount",
		direction: "descending"
	});
	const rowsPerPage = 10;

	// Author filtering and sorting
	const filteredAuthors = useMemo(() => {
		let filtered = authorStats;

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

			// Handle undefined values
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
	}, [authorStats, authorsSearch, authorsSortDescriptor]);

	const paginatedAuthors = useMemo(() => {
		const start = (authorsPage - 1) * rowsPerPage;
		const end = start + rowsPerPage;
		return filteredAuthors.slice(start, end);
	}, [filteredAuthors, authorsPage]);

	const authorsPages = Math.ceil(filteredAuthors.length / rowsPerPage);

	// Reset authors page when search changes
	useEffect(() => {
		setAuthorsPage(1);
	}, [authorsSearch]);

	return (
		<SectionCard title={t("authorAnalytics")} icon={BsPeople}>
			<div className="space-y-8">
				{/* Author Overview Stats */}
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
					<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20">
						<div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-2">
							{authorProductivityStats.totalAuthors.toLocaleString()}
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
							{authorProductivityStats.authorsWithMultipleWorks.toLocaleString()}
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
							{authorCollaborationStats.collaborationRate}%
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
							{authorProductivityStats.avgItemsPerAuthor}
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
					{/* Author Productivity Distribution */}
					<motion.div variants={itemVariants} className="space-y-4">
						<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
							<BsBarChart className="text-accent" />
							{t("globalAuthorProductivityDistribution")}
						</h3>
						<Card color="card" className="p-6">
							<div className="h-96">
								<ResponsiveContainer width="100%" height="100%">
									<BarChart
										data={authorProductivityStats.productivityDistribution}
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
							{t("topResearchers", { count: authorStats.length })}
						</h3>
						<Card color="card" className="p-6">
							<div className="space-y-4 h-96 overflow-y-auto">
								{authorStats.slice(0, 20).map((author, index) => (
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
						{t("detailedAuthorStatistics", { count: authorStats.length })}
					</h3>
					<div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/30 rounded-xl p-4 mb-4">
						<div className="text-sm text-blue-800 dark:text-blue-200">
							<strong>{t("note")}:</strong> {t("authorTableNote", { count: authorStats.length })}
							{t("globalStatsNote", { total: authorProductivityStats.totalAuthors.toLocaleString() })}
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
	);
} 