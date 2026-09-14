"use client";

import type { ReactNode } from "react";
import { Accordion, AccordionItem } from "@nextui-org/react";
import { useReducedMotion } from "framer-motion";

export function AdminStatusAccordion({
	title,
	summary,
	action,
	children,
}: {
	title: string;
	summary: ReactNode;
	action?: ReactNode;
	children: ReactNode;
}) {
	const reducedMotion = useReducedMotion();
	return (
		<div className="relative" data-admin-status-accordion={title}>
			{action && (
				<div className="absolute right-6 top-2.5 z-10">{action}</div>
			)}
			<Accordion
				defaultSelectedKeys={[]}
				showDivider={false}
				disableAnimation={Boolean(reducedMotion)}
				className="px-0"
				itemClasses={{
					base: "px-0",
					trigger: `relative min-h-12 gap-3 rounded-lg px-0 py-2 ${action ? "pr-28" : ""}`,
					titleWrapper: "min-w-0",
					title: "text-[13px] font-semibold text-black/85 dark:text-white/85",
					subtitle:
						"mt-1 text-[11px] leading-4 text-black/50 dark:text-white/50",
					indicator: `text-black/40 dark:text-white/40 ${action ? "absolute right-0" : ""}`,
					content: "pb-2 pt-1",
				}}
			>
				<AccordionItem
					key="section"
					aria-label={title}
					title={title}
					subtitle={summary}
				>
					{children}
				</AccordionItem>
			</Accordion>
		</div>
	);
}
