"use client";

import type { ReactNode } from "react";
import { Tooltip } from "@/components/nextui/Tooltip";

const styles = {
	tabs: {
		group: "flex",
		button: "relative flex min-w-0 items-center justify-center gap-1.5 px-2 py-3 text-[11px] font-medium transition-background-text outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus flex-1",
		active: "bg-transparent text-black/85 dark:text-white/85",
		inactive:
			"bg-black/[0.04] text-black/50 hover:text-black/80 dark:bg-black/20 dark:text-white/50 dark:hover:text-white/80",
	},
	inset: {
		group: "flex rounded-lg bg-black/[0.035] p-1 dark:bg-white/[0.04]",
		button: "flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[10px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus",
		active: "bg-white text-black/80 shadow-sm dark:bg-white/[0.08] dark:text-white/85",
		inactive: "text-black/45 dark:text-white/45",
	},
};

/** The inspector's provider tabs and secondary identifier choices. */
export function InspectorChoices<Key extends string>({
	label,
	value,
	options,
	onChange,
	disabled = false,
	variant = "tabs",
}: {
	label: string;
	value: Key | undefined;
	options: readonly { key: Key; label: string; content: ReactNode; disabledReason?: string }[];
	onChange: (key: Key) => void;
	disabled?: boolean;
	variant?: keyof typeof styles;
}) {
	const style = styles[variant];
	return (
		<div role="group" aria-label={label} className={style.group}>
			{options.map((option) => (
				<Tooltip key={option.key} content={option.disabledReason} isDisabled={!option.disabledReason}>
				<span className="flex min-w-0 flex-1" tabIndex={option.disabledReason ? 0 : undefined}>
				<button
					type="button"
					disabled={disabled || Boolean(option.disabledReason)}
					aria-label={option.label}
					aria-pressed={value === option.key}
					onClick={() => onChange(option.key)}
					className={`${style.button} ${value === option.key ? style.active : style.inactive} disabled:pointer-events-none`}
				>
					{option.content}
				</button>
				</span>
				</Tooltip>
			))}
		</div>
	);
}
