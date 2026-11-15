import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { BarChartIcon, ChartIncreaseIcon, Flag02Icon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
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
	PieChart,
	Pie,
	Cell,
	Legend,
} from "recharts";
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from "@/components/nextui/Table";
import { Pagination } from "@/components/nextui/Pagination";
import { Card } from "@/components/nextui/Card";
import { SectionCard } from "./SectionCard";
import { CountryCell, CountryFlag } from "./CountryFlag";
import { AuthorCountryStats, CreatorStats } from "./types";

type AuthorCountriesProps = {
	authorCountries: AuthorCountryStats[];
	creatorStats: CreatorStats;
};

const itemVariants = {
	hidden: { y: 20, opacity: 0 },
	show: { y: 0, opacity: 1 },
};

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

export function AuthorCountries({ authorCountries, creatorStats }: AuthorCountriesProps) {
  const locale = useLocale();
	const t = useTranslations("ui");
	const { resolvedTheme: theme } = useTheme();
	const [countriesPage, setCountriesPage] = useState(1);
	const [countriesSortDescriptor, setCountriesSortDescriptor] = useState<{ column: string, direction: "ascending" | "descending" }>({
		column: "itemCount",
		direction: "descending"
	});
	const rowsPerPage = 10;

	const sortedCountries = useMemo(() => {
		return [...authorCountries].sort((a, b) => {
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
	}, [authorCountries, countriesSortDescriptor]);

	const paginatedCountries = useMemo(() => {
		const start = (countriesPage - 1) * rowsPerPage;
		const end = start + rowsPerPage;
		return sortedCountries.slice(start, end);
	}, [sortedCountries, countriesPage]);

	const countriesPages = Math.ceil(sortedCountries.length / rowsPerPage);

	return (
		<SectionCard title={t("coauthorCountries")} icon={Flag02Icon}>
			<div className="space-y-8">
				{/* Hero Stats Row */}
				<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
					<motion.div
						variants={itemVariants}
						className="text-center p-6 rounded-2xl bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/20"
					>
						<div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-2">
							{authorCountries.length}
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
							{creatorStats.uniqueCreators.toLocaleString(locale)}
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
								creatorStats.uniqueCreators /
								authorCountries.length
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
								...authorCountries.map(
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
							<HugeiconsIcon icon={BarChartIcon} className="text-accent" />
							{t("authorsVsItems")}
						</h3>
						<Card color="card" className="p-6">
							<div className="h-96">
								<ResponsiveContainer
									width="100%"
									height="100%"
								>
									<BarChart
										data={authorCountries
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
												value.toLocaleString(locale)
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
																	{data.authors.toLocaleString(locale)}
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
																	{data.items.toLocaleString(locale)}
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
						<HugeiconsIcon icon={ChartIncreaseIcon} className="text-accent" />
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
										data={authorCountries
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
										{authorCountries
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
																{data.itemCount.toLocaleString(locale)}
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
																{data.authorCount.toLocaleString(locale)}
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
						<HugeiconsIcon icon={Flag02Icon} className="text-accent" />
						{t("topCountriesLeaderboard")}
					</h3>
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
						{authorCountries
							.slice(0, 12)
							.map((country, index) => (
								<motion.div
									key={index}
									variants={itemVariants}
									className="relative p-4 rounded-xl bg-gradient-to-r from-black/5 to-transparent dark:from-white/5 border border-black/10 dark:border-white/10 hover:border-accent/30 transition-colors duration-300 hover:scale-[1.02] group"
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
											<div className="text-xs text-black/60 dark:text-white/60 space-x-3">
												<span className="text-blue-600 dark:text-blue-400 font-medium">
													{country.itemCount.toLocaleString(locale)}
												</span>
												<span className="text-emerald-600 dark:text-emerald-400 font-medium">
											{country.authorCount.toLocaleString(locale)}
												</span>
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

				{/* Author Countries Table */}
				<motion.div variants={itemVariants} className="space-y-4">
					<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
						<HugeiconsIcon icon={Flag02Icon} className="text-accent" />
						{t("coauthorCountriesTable")}
					</h3>
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
											<CountryCell country={country} />
										</TableCell>
										<TableCell>
											<div className="font-medium">
												{country.authorCount.toLocaleString(locale)}
											</div>
										</TableCell>
										<TableCell>
											<div className="font-medium">
												{country.itemCount.toLocaleString(locale)}
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
				</motion.div>
			</div>
		</SectionCard>
	);
} 