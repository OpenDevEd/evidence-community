import type { ComponentProps } from "react";
import { useTheme } from "next-themes";
import {
	BarChart,
	Bar,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	ResponsiveContainer,
	type TooltipProps,
} from "recharts";
import { Card } from "@/components/nextui/Card";

type DistributionBarChartProps = {
	data: ComponentProps<typeof BarChart>["data"];
	/** The category axis; the count axis and the tooltip look the same on every distribution. */
	xAxis: ComponentProps<typeof XAxis>;
	formatter: TooltipProps<number, string>["formatter"];
};

const tooltipColors = {
	dark: {
		background: "#1a1a1a",
		border: "rgba(255, 255, 255, 0.1)",
		label: "#ffffff",
		item: "rgba(255, 255, 255, 0.8)",
	},
	light: {
		background: "#ffffff",
		border: "rgba(0, 0, 0, 0.1)",
		label: "#000000",
		item: "rgba(0, 0, 0, 0.8)",
	},
};

/** A bar per category counting its entries, in a card. */
export function DistributionBarChart({ data, xAxis, formatter }: DistributionBarChartProps) {
	const { resolvedTheme: theme } = useTheme();
	const colors = tooltipColors[theme === "dark" ? "dark" : "light"];

	return (
		<Card color="card" className="p-6">
			<div className="h-96">
				<ResponsiveContainer width="100%" height="100%">
					<BarChart
						data={data}
						margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
					>
						<CartesianGrid strokeDasharray="3 3" className="stroke-black/10 dark:stroke-white/10" />
						<XAxis
							className="text-black/60 dark:text-white/60"
							axisLine={false}
							{...xAxis}
						/>
						<YAxis
							className="text-black/60 dark:text-white/60"
							tick={{ fontSize: 12 }}
							axisLine={false}
							tickFormatter={(value) => value.toLocaleString()}
						/>
						<Tooltip
							contentStyle={{
								backgroundColor: colors.background,
								border: `1px solid ${colors.border}`,
								borderRadius: "12px",
								boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
								padding: "12px",
							}}
							labelStyle={{ color: colors.label, fontWeight: "500" }}
							itemStyle={{ color: colors.item }}
							formatter={formatter}
						/>
						<Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} />
					</BarChart>
				</ResponsiveContainer>
			</div>
		</Card>
	);
}
