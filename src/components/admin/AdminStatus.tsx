"use client";

import {
	ArchiveIcon,
	CloudUploadIcon,
	FileAttachmentIcon,
	FileClockIcon,
	FileXIcon,
	PencilIcon,
	Undo02Icon,
	Tick01Icon,
	ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/Hugeicon";

import type { AdminFileState, AdminRecordState } from "@/lib/admin/types";

const stateConfig = {
	deleted: {
		className: "text-black/45 dark:text-white/45",
		icon: ArchiveIcon,
		label: "Deleted",
	},
	draft: {
		className: "text-amber-700 dark:text-amber-300",
		icon: FileClockIcon,
		label: "Draft",
	},
	edited: {
		className: "text-accent-300 dark:text-accent-700",
		icon: PencilIcon,
		label: "Edited",
	},
	published: {
		className: "text-emerald-700 dark:text-emerald-300",
		icon: Tick01Icon,
		label: "Published",
	},
} as const;

const fileConfig = {
	none: {
		className: "text-black/40 dark:text-white/40",
		icon: FileXIcon,
		label: "No PDF",
	},
	unpublished: {
		className: "text-black/55 dark:text-white/55",
		icon: ViewOffSlashIcon,
		label: "Not published",
	},
	processing: {
		className: "text-amber-700 dark:text-amber-300",
		icon: Undo02Icon,
		label: "Processing",
	},
	staged: {
		className: "text-accent-300 dark:text-accent-700",
		icon: CloudUploadIcon,
		label: "Staged",
	},
	published: {
		className: "text-emerald-700 dark:text-emerald-300",
		icon: Tick01Icon,
		label: "PDF live",
	},
} as const;

function Status({
	className,
	icon,
	label,
}: {
	className: string;
	icon: IconSvgElement;
	label: string;
}) {
	return (
		<span
			className={`inline-flex h-6 items-center gap-1 whitespace-nowrap text-[11px] font-medium ${className}`}
		>
			<HugeiconsIcon icon={icon} aria-hidden size={12} strokeWidth={2} />
			{label}
		</span>
	);
}

export function RecordStateChip({ state }: { state: AdminRecordState }) {
	return <Status {...stateConfig[state]} />;
}

export function FileStateChip({ state, snapshot = false }: { state: AdminFileState; snapshot?: boolean }) {
	const config = fileConfig[state];
	return <Status {...config} {...(snapshot && state !== "none" ? {
		icon: FileAttachmentIcon,
		label: "PDF included",
	} : {})} />;
}
