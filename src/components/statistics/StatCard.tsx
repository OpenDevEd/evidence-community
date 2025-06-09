import { motion } from "framer-motion";
import { Card } from "@/components/nextui/Card";

type StatCardProps = {
	title: string;
	value: string | number;
	subtitle?: string;
	icon: React.ElementType;
	color?: "accent" | "success" | "tertiary" | "card";
};

const itemVariants = {
	hidden: { y: 20, opacity: 0 },
	show: { y: 0, opacity: 1 },
};

export function StatCard({
	title,
	value,
	subtitle,
	icon: Icon,
	color = "accent",
}: StatCardProps) {
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