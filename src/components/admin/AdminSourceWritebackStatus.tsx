"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";
import {
	CircleAlert,
	CircleCheck,
	Clock3,
	CloudOff,
	CloudUpload,
	LoaderCircle,
	Lock,
	Pause,
	RefreshCw,
	Unplug,
} from "lucide-react";

import { Button } from "@/components/nextui/Button";
import type { AdminSourceWritebackStatus as WritebackStatus } from "@/lib/admin/source-writeback-contract";

const appearance = {
	disabled: {
		className: "text-black/45 dark:text-white/45",
		description: "Writeback is disabled for this source in the library configuration.",
		icon: CloudOff,
		label: "Writeback off",
		spin: false,
	},
	failed: {
		className: "text-danger",
		description: "The last writeback attempt failed and needs attention.",
		icon: CircleAlert,
		label: "Sync failed",
		spin: false,
	},
	idle: {
		className: "text-black/45 dark:text-white/45",
		description: "Published edits will be written back to this source.",
		icon: CloudUpload,
		label: "Writeback ready",
		spin: false,
	},
	locked: {
		className: "text-black/45 dark:text-white/45",
		description: "Writeback is locked for this record.",
		icon: Lock,
		label: "Writeback locked",
		spin: false,
	},
	paused: {
		className: "text-amber-700 dark:text-amber-300",
		description: "This source is paused. Queued edits will wait.",
		icon: Pause,
		label: "Source paused",
		spin: false,
	},
	queued: {
		className: "text-accent-700 dark:text-accent-300",
		description: "The edit is queued for writeback.",
		icon: Clock3,
		label: "Waiting to sync",
		spin: false,
	},
	removed: {
		className: "text-danger",
		description: "This record's source has been removed.",
		icon: Unplug,
		label: "Source removed",
		spin: false,
	},
	retrying: {
		className: "text-amber-700 dark:text-amber-300",
		description: "Writeback hit a temporary error and will retry automatically.",
		icon: RefreshCw,
		label: "Retrying sync",
		spin: true,
	},
	sending: {
		className: "text-accent-700 dark:text-accent-300",
		description: "The edit is being written back now.",
		icon: LoaderCircle,
		label: "Syncing",
		spin: true,
	},
	synced: {
		className: "text-emerald-700 dark:text-emerald-300",
		description: "The latest published edit was acknowledged by the source.",
		icon: CircleCheck,
		label: "Synced",
		spin: false,
	},
	unsupported: {
		className: "text-black/45 dark:text-white/45",
		description: "This source type does not support writeback.",
		icon: CloudOff,
		label: "No writeback",
		spin: false,
	},
} as const;

export function AdminSourceWritebackStatus({
	error,
	loading,
	onRefresh,
	onRetry,
	retrying,
	sourceLabel,
	status,
}: {
	error: string | null;
	loading: boolean;
	onRefresh: () => void;
	onRetry: () => void;
	retrying: boolean;
	sourceLabel: string;
	status: WritebackStatus | null;
}) {
	const state = status?.state ?? "idle";
	const config = appearance[state];
	const Icon = loading && !status ? LoaderCircle : config.icon;
	const spin = (loading && !status) || config.spin;
	const label = loading && !status ? "Checking writeback" : config.label;

	return (
		<Popover placement="bottom-start">
			<PopoverTrigger>
				<button
					aria-label={`${sourceLabel}: ${label}`}
					className={`inline-flex h-6 items-center gap-1 whitespace-nowrap text-[11px] font-medium transition-colors hover:opacity-75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${config.className}`}
					data-admin-writeback-status={state}
					type="button"
				>
					<span className="grid size-3 shrink-0 place-items-center overflow-hidden">
						<Icon
							aria-hidden
							className={spin ? "animate-spin" : undefined}
							size={12}
							strokeWidth={2}
						/>
					</span>
					{label}
				</button>
			</PopoverTrigger>
			<PopoverContent
				className="w-64 max-w-[calc(100vw-1.5rem)] rounded-xl border border-black/[0.08] bg-white p-0 shadow-lg dark:border-white/[0.09] dark:bg-card"
				data-admin-writeback-popover
			>
				<div className="w-full space-y-3 p-3">
					<div className="flex items-start gap-2.5">
						<span className={`mt-0.5 grid size-[15px] shrink-0 place-items-center ${config.className}`}>
							<Icon aria-hidden className={spin ? "animate-spin" : undefined} size={15} />
						</span>
						<div className="min-w-0 flex-1">
							<p className="truncate text-xs font-medium text-black/45 dark:text-white/45">
								{sourceLabel}
							</p>
							<p className="mt-0.5 text-sm font-semibold text-black/85 dark:text-white/90">
								{label}
							</p>
							<p className="mt-1 text-xs leading-5 text-black/55 dark:text-white/55">
								{config.description}
							</p>
						</div>
					</div>
					{error || status?.error ? (
						<p className="rounded-lg bg-danger/[0.07] px-2.5 py-2 text-xs leading-5 text-danger" role="alert">
							{error ?? status?.error}
						</p>
					) : null}
					{state === "failed" ? (
						<Button
							className="w-full"
							color="accent"
							isDisabled={retrying}
							onPress={onRetry}
							size="xs"
							startContent={<RefreshCw aria-hidden className={retrying ? "animate-spin" : undefined} size={14} />}
							variant="solid"
						>
							Retry writeback
						</Button>
					) : error ? (
						<Button className="w-full" onPress={onRefresh} size="xs" startContent={<RefreshCw aria-hidden size={14} />}>
							Check again
						</Button>
					) : null}
				</div>
			</PopoverContent>
		</Popover>
	);
}
