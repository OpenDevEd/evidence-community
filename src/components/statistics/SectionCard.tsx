import { motion } from "framer-motion";
import { Card } from "@/components/nextui/Card";

type SectionCardProps = {
	title: string;
	icon: React.ElementType;
	children: React.ReactNode;
};

const itemVariants = {
	hidden: { y: 20, opacity: 0 },
	show: { y: 0, opacity: 1 },
};

export function SectionCard({
	title,
	icon: Icon,
	children,
}: SectionCardProps) {
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