import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { BsBarChart, BsCalendar } from "react-icons/bs";
import {
	BarChart,
	Bar,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	ResponsiveContainer,
} from "recharts";
import { SectionCard } from "./SectionCard";
import { ComprehensiveStats } from "./types";

type ItemTypesAndYearsProps = {
	stats: ComprehensiveStats;
};

export function ItemTypesAndYears({ stats }: ItemTypesAndYearsProps) {
	const t = useTranslations("ui");
	const tItemType = useTranslations("itemType");
	const { resolvedTheme: theme } = useTheme();

	const chartData = stats.yearDistribution.slice(0, 15).map((year) => ({
		year: year.year,
		publications: year.count,
	}));

	return (
		<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
			<SectionCard title={t("itemTypesDistribution")} icon={BsBarChart}>
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
								tickFormatter={(value) => value.toLocaleString()}
							/>
							<Tooltip
								contentStyle={{
									backgroundColor:
										theme === "dark" ? "#1a1a1a" : "#ffffff",
									border: `1px solid ${
										theme === "dark"
											? "rgba(255, 255, 255, 0.1)"
											: "rgba(0, 0, 0, 0.1)"
									}`,
									borderRadius: "8px",
									boxShadow:
										"0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
								}}
								labelStyle={{
									color: theme === "dark" ? "#ffffff" : "#000000",
									fontWeight: "500",
								}}
								itemStyle={{
									color:
										theme === "dark"
											? "rgba(255, 255, 255, 0.8)"
											: "rgba(0, 0, 0, 0.8)",
								}}
								labelFormatter={(label) => `${t("year")} ${label}`}
								formatter={(value: number | undefined) => [
									(value ?? 0).toLocaleString() + ` ${t("publicationsLowercase")}`,
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
	);
} 
