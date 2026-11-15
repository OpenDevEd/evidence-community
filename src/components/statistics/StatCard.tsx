import { useLocale } from "next-intl";
import { motion } from "framer-motion";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/Hugeicon";
import { Card } from "@/components/nextui/Card";

type StatCardProps = {
	title: string;
	value: string | number;
	subtitle?: string;
	icon: IconSvgElement;
	color?: "accent" | "success" | "tertiary" | "card";
};

const itemVariants = {
	hidden: { y: 20, opacity: 0 },
	show: { y: 0, opacity: 1 },
};

const TONE_BACKGROUND: Record<string, string> = { accent: "bg-accent/20", success: "bg-success/20", tertiary: "bg-tertiary/20" };
const TONE_ICON: Record<string, string> = { accent: "text-accent", success: "text-success", tertiary: "text-tertiary" };

export function StatCard({
	title,
	value,
	subtitle,
	icon,
	color = "accent",
}: StatCardProps) {
  const locale = useLocale();
	return (
		<motion.div variants={itemVariants}>
			<Card
				color="card"
				className="px-6 h-32 flex justify-center items-center"
			>
				<div className="flex items-center gap-4 w-full justify-center">
					<div
						className={`self-start p-3 rounded-2xl ${TONE_BACKGROUND[color] ?? "bg-white/10 dark:bg-white/5"}`}
					>
						<HugeiconsIcon
							icon={icon}
							className={`size-6 ${TONE_ICON[color] ?? "text-black/60 dark:text-white/60"}`}
						/>
					</div>
					<div className="flex-1">
						<h3 className="text-sm font-medium text-black/60 dark:text-white/60 mb-1">
							{title}
						</h3>
						<p className="text-2xl font-bold text-black dark:text-white">
							{typeof value === "number"
								? value.toLocaleString(locale)
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
