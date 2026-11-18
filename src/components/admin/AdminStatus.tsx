"use client";

import {
	ArchiveIcon,
	CloudUploadIcon,
	Comment01Icon,
	FileAttachmentIcon,
	FileClockIcon,
	FileXIcon,
	InboxIcon,
	PencilIcon,
	Undo02Icon,
	Tick01Icon,
	ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/Hugeicon";

import type { AdminFileState, AdminRecordState, AdminRowReview } from "@/lib/admin/types";

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

/** A submitted version waiting for an editor, or sent back: said the same in the table and on the record. */
export const reviewChip = {
	pending: {
		className: "text-sky-700 dark:text-sky-300",
		icon: InboxIcon,
		label: "Awaiting review",
	},
	returned: {
		className: "text-rose-700 dark:text-rose-300",
		icon: Comment01Icon,
		label: "Changes requested",
	},
	declined: {
		className: "text-rose-700 dark:text-rose-300",
		icon: Comment01Icon,
		label: "Declined",
	},
} as const;

/**
 * A record's state. One waiting for an editor, or sent back, says that: it is what the person looking for it needs to
 * know. A deleted record that was withdrawn, because its DOI is real, says so.
 */
export function RecordStateChip({ state, review = null, withdrawn = false }: { state: AdminRecordState; review?: AdminRowReview | null; withdrawn?: boolean }) {
	if (review && state !== "deleted") return <Status {...reviewChip[review]} />;
	return <Status {...stateConfig[state]} {...(state === "deleted" && withdrawn ? { label: "Withdrawn" } : {})} />;
}

export function FileStateChip({ state, snapshot = false }: { state: AdminFileState; snapshot?: boolean }) {
	const config = fileConfig[state];
	return <Status {...config} {...(snapshot && state !== "none" ? {
		icon: FileAttachmentIcon,
		label: "PDF included",
	} : {})} />;
}
