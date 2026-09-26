"use client";

import { AuthorProfilesContext, useAuthorProfiles } from "@/lib/authors/use-author-profiles";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import {
	BarChartIcon,
	Calendar01Icon,
	Globe02Icon,
	QuoteUpIcon,
	SearchRemoveIcon,
	UserIcon,
} from "@hugeicons/core-free-icons";
import { useQueryState, parseAsInteger } from "nuqs";
import { Item } from "@/app/api/item/types";
import { CitationsResponse } from "@/app/api/citations/[key]/route";
import { CountryFlag } from "@/components/statistics/CountryFlag";
import { COUNTRY_COLORS, COUNTRIES } from "@/constants/misc";
import PageContainer from "@/components/layout/PageContainer";
import { Card } from "@/components/nextui/Card";
import { Button } from "@/components/nextui/Button";
import { Skeleton } from "@/components/nextui/Skeleton";
import Resource from "@/components/features/items/Resource";
import ItemHeader from "@/components/features/newlib/ItemHeader";
import ItemTitle from "@/components/features/newlib/ItemTitle";
import ResourceAuthors from "@/components/features/items/ResourceAuthors";
import { Pagination } from "@/components/nextui/Pagination";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";
import {
	Chart as ChartJS,
	CategoryScale,
	LinearScale,
	BarElement,
	Title,
	Tooltip,
	Legend,
	ChartOptions,
	ChartData,
	ArcElement,
} from "chart.js";
import { Bar, Pie } from "react-chartjs-2";

ChartJS.register(
	CategoryScale,
	LinearScale,
	BarElement,
	Title,
	Tooltip,
	Legend,
	ArcElement,
);
import { useState, useEffect, useRef, useMemo } from "react";
import { TruncatedText } from "@/components/nextui/TruncatedText";

function visibleExternalTooltip<T extends { visible: boolean }>(
	context: any,
	setState: (update: (previous: T) => T) => void,
) {
	const tooltipModel = context.tooltip;
	if (tooltipModel.opacity === 0) {
		setState((previous) =>
			previous.visible ? { ...previous, visible: false } : previous,
		);
		return null;
	}
	return {
		tooltipModel,
		dataPoint: tooltipModel.dataPoints[0],
	};
}

function externalTooltipPlugins(external: (context: any) => void) {
	return {
		legend: { display: false },
		tooltip: { enabled: false, external },
	};
}

function CitationStats({
	libraryCitationCount,
	yearDistribution,
	isLoading,
}: {
	libraryCitationCount: number;
	yearDistribution: { year: string; count: number }[];
	isLoading: boolean;
}) {
	const t = useTranslations("ui");

	const totalFromYears = yearDistribution.reduce(
		(sum, item) => sum + item.count,
		0,
	);
	const yearsWithCitations = yearDistribution.filter(
		(y) => y.count > 0,
	).length;
	const avgPerYear =
		yearsWithCitations > 0
			? (totalFromYears / yearsWithCitations).toFixed(1)
			: "0";
	const peakYear =
		yearDistribution.length > 0
			? yearDistribution.reduce(
					(max, item) => (item.count > max.count ? item : max),
					yearDistribution[0],
				)
			: null;

	const stats = [
		{
			label: t("libraryCitations"),
			value: libraryCitationCount.toLocaleString(),
			color: "from-blue-500/10 to-blue-600/5 border-blue-500/20",
			textColor: "text-blue-600 dark:text-blue-400",
		},
		{
			label: t("yearsCovered"),
			value: yearsWithCitations.toString(),
			color: "from-emerald-500/10 to-emerald-600/5 border-emerald-500/20",
			textColor: "text-emerald-600 dark:text-emerald-400",
		},
		{
			label: t("avgCitationsPerYear"),
			value: avgPerYear,
			color: "from-amber-500/10 to-amber-600/5 border-amber-500/20",
			textColor: "text-amber-600 dark:text-amber-400",
		},
		{
			label: t("peakYear"),
			value: peakYear ? (
				<div className="flex items-baseline justify-center gap-1.5">
					<span>{peakYear.year}</span>
					<span className="text-lg opacity-60 font-medium">
						{peakYear.count}
					</span>
				</div>
			) : (
				"-"
			),
			color: "from-purple-500/10 to-purple-600/5 border-purple-500/20",
			textColor: "text-purple-600 dark:text-purple-400",
		},
	];

	return (
		<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
			{stats.map((stat, index) => (
				<Skeleton
					key={index}
					isLoaded={!isLoading}
					className="rounded-2xl"
				>
					<div
						className={`text-center p-6 rounded-2xl bg-gradient-to-br ${stat.color} border`}
					>
						<div
							className={`text-2xl md:text-3xl font-bold ${stat.textColor} mb-2`}
						>
							{stat.value}
						</div>
						<div className="text-sm font-medium text-black/60 dark:text-white/60">
							{stat.label}
						</div>
					</div>
				</Skeleton>
			))}
		</div>
	);
}

function CitationYearChart({
	yearDistribution,
	isLoading,
	publicationYear,
}: {
	yearDistribution: { year: string; count: number }[];
	isLoading: boolean;
	publicationYear?: string;
}) {
	const t = useTranslations("ui");
	const { resolvedTheme: theme } = useTheme();

	const [accentColor, setAccentColor] = useState<string>("#3B82F6"); // Default blue
	const [fontFamily, setFontFamily] = useState<string>("sans-serif");
	const [tooltipState, setTooltipState] = useState({
		visible: false,
		top: 0,
		left: 0,
		year: "",
		count: 0,
	});
	const accentRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (accentRef.current) {
			const computedStyle = getComputedStyle(accentRef.current);
			const computedColor = computedStyle.color;
			// Get font family from body to match the site's theme
			const bodyFont = getComputedStyle(document.body).fontFamily;

			if (computedColor) {
				setAccentColor(computedColor);
			}
			if (bodyFont) {
				setFontFamily(bodyFont);
			}
		}
	}, [theme]);

	const fillMissingYears = (data: { year: string; count: number }[]) => {
		if (data.length === 0 && !isLoading) return [];

		const currentYear = new Date().getFullYear();
		const years = data
			.map((d) => parseInt(d.year))
			.filter((y) => !isNaN(y));
		const minCitationYear =
			years.length > 0 ? Math.min(...years) : currentYear;
		const maxYear = years.length > 0 ? Math.max(...years) : currentYear;

		let startYear: number;

		if (publicationYear && !isNaN(parseInt(publicationYear))) {
			// Start from publication year, but ensure we include earlier citations if any (e.g. preprints)
			startYear = Math.min(parseInt(publicationYear), minCitationYear);
		} else {
			// Default fallback: 20 years ago or earliest citation
			startYear = Math.min(currentYear - 20, minCitationYear);
		}

		// End at current year or the latest citation year if it's later
		const endYear = Math.max(currentYear, maxYear);

		const filledData = [];
		for (let year = startYear; year <= endYear; year++) {
			const yearStr = year.toString();
			// Use String() comparison to handle potential number/string mismatches
			const existing = data.find((d) => String(d.year) === yearStr);
			filledData.push(existing || { year: yearStr, count: 0 });
		}

		return filledData;
	};

	const chartData = fillMissingYears(yearDistribution);

	const options: ChartOptions<"bar"> = useMemo(
		() => ({
			responsive: true,
			maintainAspectRatio: false,
			plugins: externalTooltipPlugins((context: any) => {
				const tooltip = visibleExternalTooltip(
					context,
					setTooltipState,
				);
				if (!tooltip) return;
				const { dataPoint, tooltipModel } = tooltip;

				setTooltipState((prev) => {
					if (
						prev.visible === true &&
						prev.top === tooltipModel.caretY &&
						prev.left === tooltipModel.caretX &&
						prev.year === dataPoint.label &&
						prev.count === (dataPoint.raw as number)
					) {
						return prev;
					}

					return {
						visible: true,
						top: tooltipModel.caretY,
						left: tooltipModel.caretX,
						year: dataPoint.label,
						count: dataPoint.raw as number,
					};
				});
			}),
			scales: {
				x: {
					grid: {
						display: false,
					},
					title: {
						display: false,
					},
					ticks: {
						color:
							theme === "dark"
								? "rgba(255,255,255,0.8)"
								: "rgba(0,0,0,0.8)",
						font: {
							family: fontFamily,
							size: 14,
							weight: "bold",
						},
					},
					border: {
						display: false,
					},
				},
				y: {
					grid: {
						color:
							theme === "dark"
								? "rgba(255,255,255,0.1)"
								: "rgba(0,0,0,0.1)",
					},
					title: {
						display: false,
					},
					ticks: {
						color:
							theme === "dark"
								? "rgba(255,255,255,0.8)"
								: "rgba(0,0,0,0.8)",
						font: {
							family: fontFamily,
							size: 14,
							weight: "bold",
						},
						maxTicksLimit: 6,
					},
					border: {
						display: false,
					},
				},
			},
			animation: {
				duration: 1500,
				easing: "easeOutQuart",
			},
		}),
		[theme, fontFamily],
	);

	const data: ChartData<"bar"> = useMemo(
		() => ({
			labels: chartData.map((d) => d.year),
			datasets: [
				{
					label: t("citationsColumn"),
					data: chartData.map((d) => d.count),
					backgroundColor: accentColor,
					borderRadius: 4,
					barThickness: "flex",
					maxBarThickness: 40,
				},
			],
		}),
		[chartData, accentColor, t],
	);

	if (chartData.length === 0 && !isLoading) {
		return null;
	}

	return (
		<div>
			{/* Hidden element to capture accent color */}
			<div
				ref={accentRef}
				className="text-accent hidden"
				aria-hidden="true"
			/>

			<div className="flex items-center gap-3 mb-6">
				<div className="p-2 rounded-xl bg-accent/20">
					<HugeiconsIcon
						icon={BarChartIcon}
						className="size-5 text-accent"
					/>
				</div>
				<h2 className="text-xl font-semibold text-black dark:text-white">
					{t("citationsByYear")}
				</h2>
			</div>

			<Skeleton isLoaded={!isLoading} className="rounded-2xl">
				<Card color="card" className="h-96 p-4 pt-8 overflow-visible">
					<div className="flex h-full w-full gap-4">
						{/* Y-Axis Label */}
						<div className="flex items-center justify-center w-6 shrink-0">
							<div className="-rotate-90 whitespace-nowrap flex items-center gap-2 text-tiny uppercase tracking-widest font-bold text-default-400">
								<HugeiconsIcon
									icon={QuoteUpIcon}
									className="rotate-90"
								/>
								{t("citationsColumn")}
							</div>
						</div>

						<div className="flex flex-col flex-grow h-full min-w-0 relative">
							<div className="flex-grow min-h-0 relative">
								<Bar options={options} data={data} />

								{/* Custom Tooltip */}
								{tooltipState.visible && (
									<div
										className="absolute z-10 pointer-events-none transition-all duration-200 ease-out"
										style={{
											top: tooltipState.top,
											left: tooltipState.left,
											transform:
												"translate(-50%, -100%) translateY(-10px)",
										}}
									>
										<div className="min-w-[140px] rounded-xl border border-default-200 bg-white p-3 shadow-xl dark:border-default-100 dark:bg-zinc-900">
											<div className="flex items-center gap-2">
												<HugeiconsIcon
													icon={Calendar01Icon}
													className="text-default-400 text-tiny"
												/>
												<span className="text-tiny font-bold uppercase tracking-wider text-default-500">
													{tooltipState.year}
												</span>
											</div>
											<div className="flex items-center gap-2">
												<HugeiconsIcon
													icon={QuoteUpIcon}
													className="text-accent text-lg"
												/>
												<div className="flex items-baseline gap-1">
													<span className="text-xl font-bold text-accent">
														{tooltipState.count}
													</span>
													<span className="text-tiny font-medium text-accent/60 uppercase tracking-wide">
														{t(
															"citationsLowercase",
														)}
													</span>
												</div>
											</div>
										</div>
										{/* Arrow */}
										<div className="absolute left-1/2 -translate-x-1/2 bottom-[-6px] w-3 h-3 bg-white/90 dark:bg-zinc-900/90 border-r border-b border-default-200 dark:border-default-100 rotate-45" />
									</div>
								)}
							</div>

							{/* X-Axis Label */}
							<div className="h-6 shrink-0 flex items-center justify-center mt-2">
								<div className="flex items-center gap-2 text-tiny uppercase tracking-widest font-bold text-default-400">
									<HugeiconsIcon
										icon={Calendar01Icon}
										className="text-default-300"
									/>
									{t("year")}
								</div>
							</div>
						</div>
					</div>
				</Card>
			</Skeleton>
		</div>
	);
}

function CitationsCountryChart({
	countryDistribution,
	isLoading,
}: {
	countryDistribution: { country: string; count: number }[];
	isLoading: boolean;
}) {
	const t = useTranslations("ui");
	const { resolvedTheme: theme } = useTheme();

	const [tooltipState, setTooltipState] = useState({
		visible: false,
		top: 0,
		left: 0,
		country: "",
		count: 0,
		percentage: "0",
	});

	// Colors from AuthorCountries.tsx
	const pieColors = countryDistribution.map(
		(d) => COUNTRY_COLORS[d.country] || "#cccccc",
	);

	const data: ChartData<"pie"> = useMemo(
		() => ({
			labels: countryDistribution.map(
				(d) => COUNTRIES[d.country] || d.country,
			),
			datasets: [
				{
					data: countryDistribution.map((d) => d.count),
					backgroundColor: pieColors,
					borderColor: theme === "dark" ? "#18181b" : "#ffffff",
					borderWidth: 3,
				},
			],
		}),
		[countryDistribution, pieColors, theme],
	);

	const options: ChartOptions<"pie"> = useMemo(
		() => ({
			responsive: true,
			maintainAspectRatio: false,
			cutout: "60%", // Donut style
			plugins: externalTooltipPlugins((context: any) => {
				const tooltip = visibleExternalTooltip(
					context,
					setTooltipState,
				);
				if (!tooltip) return;
				const { dataPoint, tooltipModel } = tooltip;
				const rawValue = dataPoint.raw as number;
				const total = (
					context.chart.data.datasets[0].data as number[]
				).reduce((a, b) => a + b, 0);
				const percentage = ((rawValue / total) * 100).toFixed(1);

				// Find the original country code from the index since labels are now full names
				const countryCode =
					countryDistribution[dataPoint.dataIndex].country;

				setTooltipState((prev) => {
					if (
						prev.visible === true &&
						prev.top === tooltipModel.caretY &&
						prev.left === tooltipModel.caretX &&
						prev.country === countryCode &&
						prev.count === rawValue &&
						prev.percentage === percentage
					) {
						return prev;
					}

					return {
						visible: true,
						top: tooltipModel.caretY,
						left: tooltipModel.caretX,
						country: countryCode,
						count: rawValue,
						percentage: percentage,
					};
				});
			}),
		}),
		[countryDistribution, theme],
	);

	const totalCitations = countryDistribution.reduce(
		(acc, curr) => acc + curr.count,
		0,
	);

	if (countryDistribution.length === 0 && !isLoading) {
		return null;
	}

	return (
		<div>
			<div className="flex items-center gap-3 mb-6">
				<div className="p-2 rounded-xl bg-accent/20">
					<HugeiconsIcon
						icon={Globe02Icon}
						className="size-5 text-accent"
					/>
				</div>
				<h2 className="text-xl font-semibold text-black dark:text-white">
					{t("citationsByCountryFocus")}
				</h2>
			</div>

			<Skeleton isLoaded={!isLoading} className="rounded-2xl">
				<Card color="card" className="h-96 p-6 overflow-visible">
					<div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center h-full">
						<div className="h-full relative min-h-0 flex items-center justify-center">
							<div className="relative w-full h-full">
								<Pie data={data} options={options} />
								{/* Center Text for Donut */}
								<div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
									<span className="text-3xl font-bold text-black dark:text-white">
										{
											countryDistribution.filter(
												(d) => d.country !== "UNKNOWN",
											).length
										}
									</span>
									<span className="text-xs uppercase tracking-wider font-medium text-black/50 dark:text-white/50">
										{t("countries")}
									</span>
								</div>

								{/* Custom Tooltip */}
								{tooltipState.visible && (
									<div
										className="absolute z-10 pointer-events-none transition-all duration-200 ease-out"
										style={{
											top: tooltipState.top,
											left: tooltipState.left,
											transform:
												"translate(-50%, -100%) translateY(-10px)",
										}}
									>
										<div className="min-w-[140px] rounded-xl border border-default-200 bg-white p-3 shadow-xl dark:border-default-100 dark:bg-zinc-900">
											<div className="flex items-center gap-2 mb-1">
												{tooltipState.country ===
												"UNKNOWN" ? (
													<HugeiconsIcon
														icon={Globe02Icon}
														className="w-4 h-3 text-gray-400"
													/>
												) : (
													<CountryFlag
														countryCode={
															tooltipState.country
														}
														className="w-4 h-3 shadow-sm"
													/>
												)}
												<span className="text-tiny font-bold uppercase tracking-wider text-default-500 truncate max-w-[150px]">
													{tooltipState.country ===
													"UNKNOWN"
														? t(
																"globalOrUnspecified",
															)
														: COUNTRIES[
																tooltipState
																	.country
															] ||
															tooltipState.country}
												</span>
											</div>
											<div className="flex items-center gap-2">
												<HugeiconsIcon
													icon={QuoteUpIcon}
													className="text-accent text-lg"
												/>
												<div className="flex items-baseline gap-1">
													<span className="text-xl font-bold text-accent">
														{tooltipState.count}
													</span>
													<span className="text-tiny font-medium text-accent/60 uppercase tracking-wide">
														(
														{
															tooltipState.percentage
														}
														%)
													</span>
												</div>
											</div>
										</div>
										{/* Arrow */}
										<div className="absolute left-1/2 -translate-x-1/2 bottom-[-6px] w-3 h-3 bg-white/90 dark:bg-zinc-900/90 border-r border-b border-default-200 dark:border-default-100 rotate-45" />
									</div>
								)}
							</div>
						</div>

						{/* Custom Legend */}
						<div className="flex flex-col gap-3 max-h-full overflow-y-auto pr-2 custom-scrollbar">
							{countryDistribution.map((item, index) => {
								const percentage = (
									(item.count / totalCitations) *
									100
								).toFixed(1);
								const isUnknown = item.country === "UNKNOWN";
								const countryName = isUnknown
									? t("globalOrUnspecified")
									: COUNTRIES[item.country] || item.country;
								return (
									<div
										key={item.country}
										className="flex items-center justify-between p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
									>
										<div className="flex items-center gap-3">
											<div
												className="w-2 h-8 rounded-full shrink-0"
												style={{
													backgroundColor:
														COUNTRY_COLORS[
															item.country
														] || "#cccccc",
												}}
											/>
											<div className="flex flex-col">
												<div className="flex items-center gap-2">
													{isUnknown ? (
														<HugeiconsIcon
															icon={Globe02Icon}
															className="w-4 h-3 text-gray-400"
														/>
													) : (
														<CountryFlag
															countryCode={
																item.country
															}
															className="w-4 h-3 shadow-sm"
														/>
													)}
													<TruncatedText
														text={countryName || t("unknownCountry")}
														className="max-w-[120px] font-bold text-black/80 dark:text-white/80"
													/>
												</div>
												<span className="text-xs font-medium text-black/40 dark:text-white/40">
													{t("percentOfTotal", {
														percentage,
													})}
												</span>
											</div>
										</div>
										<div className="flex flex-col items-end">
											<span className="text-lg font-bold text-black dark:text-white">
												{item.count}
											</span>
											<span className="text-[10px] uppercase tracking-wider font-bold text-black/30 dark:text-white/30">
												{t("citationsColumn")}
											</span>
										</div>
									</div>
								);
							})}
						</div>
					</div>
				</Card>
			</Skeleton>
		</div>
	);
}

function CitingResourcesList({
	items,
	isLoading,
	totalPages,
	currentPage,
	onPageChange,
	listRef,
}: {
	items: Item[];
	isLoading: boolean;
	totalPages: number;
	currentPage: number;
	onPageChange: (page: number) => void;
	listRef: React.RefObject<HTMLDivElement | null>;
}) {
	const t = useTranslations("ui");
	const { profiles } = useAuthorProfiles(items?.flatMap(item => item.creators ?? []));


	return (
		<AuthorProfilesContext value={profiles}>
			<div ref={listRef} className="scroll-mt-20">
				<div className="flex items-center gap-3 mb-6">
					<div className="p-2 rounded-xl bg-accent/20">
						<HugeiconsIcon
							icon={QuoteUpIcon}
							className="size-5 text-accent"
						/>
					</div>
					<h2 className="text-xl font-semibold text-black dark:text-white">
						{t("citingResources")}
					</h2>
				</div>

				<ul className="flex flex-col md:grid grid-cols-2 gap-4">
					{isLoading
						? Array.from({ length: 4 }).map((_, index) => (
								<li key={`skeleton-${index}`}>
									<Resource
										as="div"
										itemData={undefined}
										isLoading={true}
										abstract={false}
										className="h-full"
										hideUnapi={true}
									/>
								</li>
							))
						: items.map((item) => (
								<li key={item.key}>
									<Resource
										as="div"
										itemData={item}
										isLoading={false}
										abstract={false}
										className="h-full"
										hideUnapi={true}
									/>
								</li>
							))}
				</ul>

				{!isLoading && items.length === 0 && (
					<div className="flex flex-col items-center justify-center py-12 text-black/60 dark:text-white/60">
						<HugeiconsIcon
							icon={SearchRemoveIcon}
							className="size-12 mb-4"
						/>
						<p className="text-lg">{t("noCitingResources")}</p>
					</div>
				)}

				{totalPages > 1 && (
					<div className="w-full flex justify-center py-2 lg:py-6 z-10">
						<Skeleton
							isLoaded={totalPages > 0}
							className="w-full h-14 rounded-2xl flex items-center justify-center"
						>
							<Pagination
								showControls
								page={currentPage}
								onChange={onPageChange}
								total={totalPages}
							/>
						</Skeleton>
					</div>
				)}
			</div>
		</AuthorProfilesContext>
	);
}

export default function CitationPageClient({
	sourceItem,
	itemKey,
}: {
	sourceItem: Item;
	itemKey: string;
}) {
	const [page, setPage] = useQueryState(
		"page",
		parseAsInteger.withDefault(1),
	);
	const listRef = useRef<HTMLDivElement>(null);

	const { data, isLoading } = useSWR<CitationsResponse>(
		`/citations/${itemKey}?page=${page}&perPage=20`,
		fetcher,
		{
			revalidateOnFocus: false,
			revalidateIfStale: false,
			keepPreviousData: true,
		},
	);

	const handlePageChange = (newPage: number) => {
		setPage(newPage);
		// Small timeout to allow state update to propagate if needed,
		// though usually scroll can happen immediately.
		// Using scrollIntoView on the list container.
		setTimeout(() => {
			listRef.current?.scrollIntoView({
				behavior: "smooth",
				block: "start",
			});
		}, 100);
	};

	return (
		<PageContainer>
			<div className="flex flex-col gap-8">
				<div>
					<ItemHeader item={sourceItem} isLoading={false} />
					<div className="mt-4">
						<ItemTitle item={sourceItem} loadingProp={false} />
						{sourceItem.creators &&
							sourceItem.creators.length > 0 && (
								<div className="flex items-center gap-2 mt-2 text-base text-black/60 dark:text-white/60">
									<HugeiconsIcon
										icon={UserIcon}
										className=""
									/>
									<ResourceAuthors itemData={sourceItem} />
								</div>
							)}
					</div>
				</div>

				<CitationStats
					libraryCitationCount={data?.libraryCitationCount || 0}
					yearDistribution={data?.yearDistribution || []}
					isLoading={data ? false : isLoading}
				/>

				<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
					<CitationYearChart
						yearDistribution={data?.yearDistribution || []}
						isLoading={data ? false : isLoading}
						publicationYear={sourceItem.year}
					/>
					<CitationsCountryChart
						countryDistribution={data?.countryDistribution || []}
						isLoading={data ? false : isLoading}
					/>
				</div>

				<CitingResourcesList
					items={data?.citingItems || []}
					isLoading={isLoading}
					totalPages={data?.totalPages || 1}
					currentPage={page}
					onPageChange={handlePageChange}
					listRef={listRef}
				/>
			</div>
		</PageContainer>
	);
}
