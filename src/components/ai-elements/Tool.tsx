"use client";

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import {
	PiCaretDownBold,
	PiCheckCircleFill,
	PiCircleNotchBold,
	PiWarningCircleFill,
} from "react-icons/pi";
import type { ComponentProps, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

type ToolState = (ToolUIPart | DynamicToolUIPart)["state"];

const statePresentation: Record<
	ToolState,
	{
		label: string;
		icon: typeof PiCircleNotchBold;
		className: string;
		busy?: boolean;
	}
> = {
	"input-streaming": {
		label: "Preparing",
		icon: PiCircleNotchBold,
		className: "text-black/35 dark:text-white/35",
		busy: true,
	},
	"input-available": {
		label: "Running",
		icon: PiCircleNotchBold,
		className: "text-black/35 dark:text-white/35",
		busy: true,
	},
	"approval-requested": {
		label: "Needs approval",
		icon: PiWarningCircleFill,
		className: "text-amber-600 dark:text-amber-400",
	},
	"approval-responded": {
		label: "Approved",
		icon: PiCircleNotchBold,
		className: "text-black/35 dark:text-white/35",
		busy: true,
	},
	"output-available": {
		label: "Completed",
		icon: PiCheckCircleFill,
		className: "text-black/30 dark:text-white/30",
	},
	"output-error": {
		label: "Failed",
		icon: PiWarningCircleFill,
		className: "text-danger",
	},
	"output-denied": {
		label: "Denied",
		icon: PiWarningCircleFill,
		className: "text-danger",
	},
};

export function Tool({
	className,
	...props
}: ComponentProps<typeof CollapsiblePrimitive.Root>) {
	return (
		<CollapsiblePrimitive.Root
			className={twMerge("group/tool", className)}
			{...props}
		/>
	);
}

export function ToolHeader({
	title,
	state,
	icon,
	className,
	...props
}: ComponentProps<typeof CollapsiblePrimitive.Trigger> & {
	title: string;
	state: ToolState;
	icon: ReactNode;
}) {
	const presentation = statePresentation[state];
	const StatusIcon = presentation.icon;

	return (
		<CollapsiblePrimitive.Trigger
			className={twMerge(
				"flex w-fit max-w-full items-center gap-2 py-1 text-left text-[13px] leading-5 text-black/45 outline-none transition-colors hover:text-black/65 focus-visible:rounded focus-visible:ring-2 focus-visible:ring-accent/30 dark:text-white/45 dark:hover:text-white/65",
				className,
			)}
			{...props}
		>
			<span className="grid size-4 shrink-0 place-items-center text-black/40 dark:text-white/40">
				{icon}
			</span>
			<span className="min-w-0 truncate font-medium">{title}</span>
			<span className="sr-only">{presentation.label}</span>
			<StatusIcon
				aria-hidden="true"
				className={twMerge(
					"ml-0.5 size-3 shrink-0",
					presentation.className,
					presentation.busy && "animate-spin",
				)}
			/>
			<PiCaretDownBold className="size-2.5 shrink-0 opacity-50 transition-transform group-data-[state=open]/tool:rotate-180" />
		</CollapsiblePrimitive.Trigger>
	);
}

export function ToolContent({
	className,
	...props
}: ComponentProps<typeof CollapsiblePrimitive.Content>) {
	return (
		<CollapsiblePrimitive.Content
			className={twMerge(
				"ml-tool-step max-w-3xl pb-1 pt-1 text-[13px] leading-5 text-black/50 dark:text-white/50",
				className,
			)}
			{...props}
		/>
	);
}
