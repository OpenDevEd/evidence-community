"use client";

import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { ArrowRight01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/Hugeicon";
import { TruncatedText } from "@/components/nextui/TruncatedText";

type InspectorListRowProps = ComponentPropsWithoutRef<"li"> & {
	icon: IconSvgElement;
	title: string;
	description?: ReactNode;
	status?: ReactNode;
	actions?: ReactNode;
	onOpen?: () => void;
	removed?: boolean;
};

function RowDescription({ value, tabIndex }: { value: ReactNode; tabIndex: 0 | undefined }) {
	return (
		<span className="min-w-0 flex-1">
			{typeof value === "string" ? <TruncatedText text={value} tabIndex={tabIndex} /> : value}
		</span>
	);
}

export function InspectorListRow({
	icon,
	title,
	description,
	status,
	actions,
	onOpen,
	removed = false,
	className = "",
	...props
}: InspectorListRowProps) {
	const [titleOpen, setTitleOpen] = useState(false);
	const content = (
		<>
			<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-black/[0.035] text-black/40 dark:bg-white/[0.045] dark:text-white/45">
				<HugeiconsIcon icon={icon} aria-hidden size={16} strokeWidth={1.7} />
			</span>
			<span className="min-w-0 flex-1">
				<TruncatedText
					text={title}
					tabIndex={onOpen ? undefined : 0}
					isOpen={titleOpen}
					onOpenChange={setTitleOpen}
					className={`text-[13px] font-medium leading-4 ${removed ? "line-through" : ""}`}
				/>
				{(description || status) && (
					<span className="flex h-4 min-w-0 items-center gap-2 whitespace-nowrap text-[11px] leading-4 text-black/45 dark:text-white/45">
						{description && (
							<RowDescription value={description} tabIndex={onOpen ? undefined : 0} />
						)}
						{status && <span className="flex shrink-0 items-center gap-2 [&>span]:h-4">{status}</span>}
					</span>
				)}
			</span>
			{onOpen && !actions && (
				<HugeiconsIcon icon={ArrowRight01Icon} aria-hidden className="shrink-0 text-black/30 dark:text-white/30" size={14} />
			)}
		</>
	);
	const contentClassName = "flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl p-2 text-left";
	return (
		<li
			{...props}
			className={`flex items-center rounded-xl bg-black/[0.025] text-black/75 transition-colors dark:bg-white/[0.04] dark:text-white/80 ${onOpen ? "hover:bg-black/[0.055] dark:hover:bg-white/[0.08]" : ""} ${removed ? "opacity-60" : ""} ${className}`}
		>
			{onOpen ? (
				<button
					type="button"
					aria-label={`Open ${title}`}
					onClick={onOpen}
					onFocus={(event) => {
						setTitleOpen(event.currentTarget.matches(":focus-visible"));
					}}
					onBlur={() => setTitleOpen(false)}
					className={`${contentClassName} bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus`}
				>
					{content}
				</button>
			) : (
				<div className={contentClassName}>{content}</div>
			)}
			{actions && <span className="flex shrink-0 items-center pr-2">{actions}</span>}
		</li>
	);
}

export function InspectorListRemove({ label, onRemove }: { label: string; onRemove: () => void }) {
	return (
		<button
			aria-label={label}
			className="grid size-7 shrink-0 place-items-center rounded-md text-black/35 hover:bg-black/[0.06] hover:text-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/35 dark:hover:bg-white/[0.07] dark:hover:text-white/75"
			onClick={onRemove}
			type="button"
		>
			<HugeiconsIcon icon={Cancel01Icon} aria-hidden size={13} />
		</button>
	);
}
