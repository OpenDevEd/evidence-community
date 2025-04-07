"use client";

import { motion } from "framer-motion";

interface ItemRowProps {
	icon: React.ReactNode;
	title: string;
	subtitle?: React.ReactNode;
}

export default function ItemRow({ icon, title, subtitle }: ItemRowProps) {
	return (
		<div className="flex items-center gap-3 px-4">
			{icon}
			<div className="flex flex-col">
				<div className="text-base font-medium">{title}</div>
				{subtitle}
			</div>
		</div>
	);
}
