"use client";

import { ArrowRight01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Fragment } from "react";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";

export type ImportKind = "dois" | "files" | "pdfs";
export type ImportStage = "done" | "input" | "review";

const STEPS: { label: string; stage: ImportStage }[] = [
	{ label: "Add", stage: "input" },
	{ label: "Review", stage: "review" },
	{ label: "Import", stage: "done" },
];

/** Where the import is: steps behind it ticked, the current one dark. */
export function ImportSteps({ stage }: { stage: ImportStage }) {
	const current = STEPS.findIndex((step) => step.stage === stage);
	return (
		<ol aria-label="Steps" className="flex items-center gap-2 text-xs">
			{STEPS.map((step, index) => {
				const done = index < current || stage === "done";
				const active = index === current;
				return (
					<Fragment key={step.stage}>
						{index ? <HugeiconsIcon aria-hidden className="text-black/25 dark:text-white/25" icon={ArrowRight01Icon} size={12} /> : null}
						<li aria-current={active ? "step" : undefined} className={`flex items-center gap-1.5 ${active ? "font-medium text-black/85 dark:text-white/85" : done ? "text-black/60 dark:text-white/60" : "text-black/35 dark:text-white/35"}`}>
							{done ? <HugeiconsIcon aria-hidden className="text-emerald-600 dark:text-emerald-400" icon={Tick02Icon} size={12} strokeWidth={2.2} /> : null}
							{step.label}
						</li>
					</Fragment>
				);
			})}
		</ol>
	);
}
