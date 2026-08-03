"use client";

import {
	Archive,
	Check,
	CloudUpload,
	FileClock,
	FileX,
	Pencil,
	RotateCcw,
} from "lucide-react";

import type { AdminFileState, AdminRecordState } from "@/lib/admin/types";

const stateConfig = {
	deleted: {
		className: "text-black/45 dark:text-white/45",
		icon: Archive,
		label: "Deleted",
	},
	draft: {
		className: "text-amber-700 dark:text-amber-300",
		icon: FileClock,
		label: "Draft",
	},
	edited: {
		className: "text-accent-700 dark:text-accent-300",
		icon: Pencil,
		label: "Edited",
	},
	published: {
		className: "text-emerald-700 dark:text-emerald-300",
		icon: Check,
		label: "Published",
	},
} as const;

const fileConfig = {
	none: {
		className: "text-black/40 dark:text-white/40",
		icon: FileX,
		label: "No PDF",
	},
	processing: {
		className: "text-amber-700 dark:text-amber-300",
		icon: RotateCcw,
		label: "Processing",
	},
	staged: {
		className: "text-accent-700 dark:text-accent-300",
		icon: CloudUpload,
		label: "Staged",
	},
	published: {
		className: "text-emerald-700 dark:text-emerald-300",
		icon: Check,
		label: "PDF live",
	},
} as const;

function Status({
	className,
	icon: Icon,
	label,
}: {
	className: string;
	icon: typeof Check;
	label: string;
}) {
	return (
		<span
			className={`inline-flex h-6 items-center gap-1 whitespace-nowrap text-[11px] font-medium ${className}`}
		>
			<Icon aria-hidden size={12} strokeWidth={2} />
			{label}
		</span>
	);
}

export function RecordStateChip({ state }: { state: AdminRecordState }) {
	const config = stateConfig[state];
	return <Status {...config} />;
}

export function FileStateChip({ state }: { state: AdminFileState }) {
	const config = fileConfig[state];
	return <Status {...config} />;
}
