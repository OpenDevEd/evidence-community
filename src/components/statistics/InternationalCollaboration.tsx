import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { BarChartIcon, Flag02Icon, HierarchyIcon, InformationCircleIcon, Share01Icon } from "@hugeicons/core-free-icons";
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
} from "recharts";
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from "@/components/nextui/Table";
import { Pagination } from "@/components/nextui/Pagination";
import { Card } from "@/components/nextui/Card";
import { SectionCard } from "./SectionCard";
import { CountryCell, CountryFlag } from "./CountryFlag";
import { CollaborationStats } from "./types";

type InternationalCollaborationProps = {
	collaborationStats: CollaborationStats;
};

const itemVariants = {
	hidden: { y: 20, opacity: 0 },
	show: { y: 0, opacity: 1 },
};

export function InternationalCollaboration({ collaborationStats }: InternationalCollaborationProps) {
  const locale = useLocale();
	const t = useTranslations("ui");
	const { resolvedTheme: theme } = useTheme();
	const [countriesPage, setCountriesPage] = useState(1);
	const [collaborationSortDescriptor, setCollaborationSortDescriptor] = useState<{ column: string, direction: "ascending" | "descending" }>({
		column: "totalItems",
		direction: "descending"
	});
	const rowsPerPage = 10;

	const sortedCollaborationCountries = useMemo(() => {
		return [...collaborationStats.countryCollaborationRates].sort((a, b) => {
			let aValue: any = a[collaborationSortDescriptor.column as keyof typeof a];
			let bValue: any = b[collaborationSortDescriptor.column as keyof typeof b];

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
	}, [collaborationStats.countryCollaborationRates, collaborationSortDescriptor]);

	const paginatedCollaborationCountries = useMemo(() => {
		const start = (countriesPage - 1) * rowsPerPage;
		const end = start + rowsPerPage;
		return sortedCollaborationCountries.slice(start, end);
	}, [sortedCollaborationCountries, countriesPage]);

	const collaborationPages = Math.ceil(sortedCollaborationCountries.length / rowsPerPage);

	return (
		<SectionCard title={t("internationalCollaboration")} icon={Share01Icon}>
			<div className="space-y-8">
				{/* Explanation */}
				<motion.div variants={itemVariants} className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/30 rounded-xl p-4">
					<h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2 flex items-center gap-2">
						<HugeiconsIcon icon={InformationCircleIcon} className="w-4 h-4" />
						{t("understandingCollaborationTypes")}
					</h4>
					<div className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
						<div><strong>{t("international")}:</strong> {t("internationalCollabDescription", { country: collaborationStats.baseCountry.countryName })}</div>
						<div><strong>{t("independent")}:</strong> {t("independentCollabDescription", { country: collaborationStats.baseCountry.countryName })}</div>
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
							{collaborationStats.overallCollaborationRate}%
						</div>
						<div className="text-sm font-medium text-black/60 dark:text-white/60">
							{t("overallCollaborationRate")}
						</div>
						<div className="text-xs text-black/40 dark:text-white/40 mt-1">
							{t("collaborativeItemsCount", { 
								collaborative: collaborationStats.collaborativeItems.toLocaleString(locale),
								total: collaborationStats.totalItems.toLocaleString(locale)
							})}
						</div>
					</motion.div>
					<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border border-emerald-500/20">
						<div className="text-3xl font-bold text-emerald-600 dark:text-emerald-400 mb-2">
							{collaborationStats.baseCountry.collaborationRate}%
						</div>
						<div className="text-sm font-medium text-black/60 dark:text-white/60 flex items-center justify-center gap-2">
							<CountryFlag countryCode={collaborationStats.baseCountry.countryCode} className="w-4 h-3" />
							{collaborationStats.baseCountry.countryName || t("unknownCountry")}
						</div>
						<div className="text-xs text-black/40 dark:text-white/40 mt-1">
							{t("collaborativeItemsCount", { 
								collaborative: collaborationStats.baseCountry.collaborativeItems.toLocaleString(locale),
								total: collaborationStats.baseCountry.totalItems.toLocaleString(locale)
							})}
						</div>
					</motion.div>
					<motion.div variants={itemVariants} className="text-center p-6 rounded-2xl bg-gradient-to-br from-amber-500/10 to-amber-600/5 border border-amber-500/20">
						<div className="text-3xl font-bold text-amber-600 dark:text-amber-400 mb-2">
							{collaborationStats.countryCollaborationRates.filter(c => c.internationalItems > 0).length}
						</div>
						<div className="text-sm font-medium text-black/60 dark:text-white/60">
							{t("countriesWithInternationalCollaborations")}
						</div>
						<div className="text-xs text-black/40 dark:text-white/40 mt-1">
							{t("ofTotalCountries", { count: collaborationStats.countryCollaborationRates.length })}
						</div>
					</motion.div>
				</div>

				{/* Charts Section */}
				<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
					{/* Collaboration Rates Chart */}
					<motion.div variants={itemVariants} className="space-y-4">
						<h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
							<HugeiconsIcon icon={BarChartIcon} className="text-accent" />
							{t("countryCollaborationRates")}
						</h3>
						<Card color="card" className="p-6">
							<div className="h-96">
								<ResponsiveContainer width="100%" height="100%">
									<BarChart
										data={collaborationStats.countryCollaborationRates.slice(0, 10).map((country) => ({
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
											isBaseCountry: country.countryCode === collaborationStats.baseCountry.countryCode,
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
																{t("totalItemsCount", { count: data.totalItems.toLocaleString(locale) })}
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
							<HugeiconsIcon icon={HierarchyIcon} className="text-accent" />
							{t("topCountryPairs")}
						</h3>
						<Card color="card" className="p-6">
							<div className="space-y-4 h-96 overflow-y-auto">
								{collaborationStats.topCollaborations.map((collab, index) => (
									<motion.div
										key={index}
										variants={itemVariants}
										className="p-4 rounded-xl bg-gradient-to-r from-black/5 to-transparent dark:from-white/5 border border-black/10 dark:border-white/10 hover:border-accent/30 transition-colors duration-300"
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
						<HugeiconsIcon icon={Flag02Icon} className="text-accent" />
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
										<CountryCell country={country} />
									</TableCell>
									<TableCell>
										<span className="font-bold text-accent">{country.totalItems.toLocaleString(locale)}</span>
									</TableCell>
									<TableCell>
										<span className="font-bold text-blue-600 dark:text-blue-400">{country.internationalItems.toLocaleString(locale)}</span>
									</TableCell>
									<TableCell>
										<span className="font-bold text-blue-600 dark:text-blue-400">{country.internationalRate}%</span>
									</TableCell>
									<TableCell>
										<span className="font-bold text-emerald-600 dark:text-emerald-400">{country.independentItems.toLocaleString(locale)}</span>
									</TableCell>
									<TableCell>
										<span className="font-bold text-emerald-600 dark:text-emerald-400">{country.independentRate}%</span>
									</TableCell>
									<TableCell>
										<span className="font-bold text-amber-600 dark:text-amber-400">{country.domesticItems.toLocaleString(locale)}</span>
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
	);
} 