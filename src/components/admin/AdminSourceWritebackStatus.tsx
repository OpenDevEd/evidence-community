"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";
import { useState } from "react";
import {
	CircleAlert,
	CircleCheck,
	GitCompareArrows,
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
	conflict: {
		className: "text-amber-600 dark:text-amber-300",
		description:
			"This source changed while updates were paused. Choose which version to keep before anything is sent.",
		icon: GitCompareArrows,
		label: "Needs a decision",
		spin: false,
	},
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

type ConflictChoice = "load-remote" | "send-local";

export function AdminSourceWritebackStatus({
	canLoadRemote = true,
	error,
	loading,
	onRefresh,
	onResolve,
	onRetry,
	retrying,
	sourceLabel,
	status,
}: {
	canLoadRemote?: boolean;
	error: string | null;
	loading: boolean;
	onRefresh: () => void;
	onResolve: (choice: ConflictChoice) => void;
	onRetry: () => void;
	retrying: boolean;
	sourceLabel: string;
	status: WritebackStatus | null;
}) {
	const state = status?.state ?? "idle";
	// Both conflict choices lose data on one side, so each needs a second click.
	// The armed choice belongs to one conflict: it is dropped as soon as the
	// state is no longer "conflict" (the badge is also keyed per record+source).
	const [pendingChoice, setPendingChoice] = useState<ConflictChoice | null>(
		null,
	);
	const armedChoice = state === "conflict" ? pendingChoice : null;
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
					{state === "conflict" ? (
						<div className="space-y-2" data-admin-writeback-conflict>
							<ConflictChoiceButton
								choice="send-local"
								description={`Replaces the ${sourceLabel} copy with this record. Changes made in ${sourceLabel} while updates were paused are lost there.`}
								disabled={retrying}
								label={`Send this record to ${sourceLabel}`}
								onConfirm={() => {
									setPendingChoice(null);
									onResolve("send-local");
								}}
								onPick={setPendingChoice}
								pending={armedChoice}
							/>
							{canLoadRemote ? (
							<ConflictChoiceButton
								choice="load-remote"
								description={`Replaces this record with the ${sourceLabel} copy. Unpublished local changes are lost.`}
								disabled={retrying}
								label={`Load ${sourceLabel}’s version`}
								onConfirm={() => {
									setPendingChoice(null);
									onResolve("load-remote");
								}}
								onPick={setPendingChoice}
								pending={armedChoice}
							/>
							) : null}
						</div>
					) : state === "failed" ? (
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

function ConflictChoiceButton({
	choice,
	description,
	disabled,
	label,
	onConfirm,
	onPick,
	pending,
}: {
	choice: ConflictChoice;
	description: string;
	disabled: boolean;
	label: string;
	onConfirm: () => void;
	onPick: (choice: ConflictChoice | null) => void;
	pending: ConflictChoice | null;
}) {
	const armed = pending === choice;
	return (
		<div className="space-y-1">
			<Button
				className="w-full"
				color={armed ? "accent" : undefined}
				data-admin-writeback-resolve={choice}
				isDisabled={disabled}
				onPress={() => (armed ? onConfirm() : onPick(choice))}
				size="xs"
				variant={armed ? "solid" : undefined}
			>
				{armed ? "Confirm" : label}
			</Button>
			<p className="text-xs leading-5 text-black/55 dark:text-white/55">
				{description}
			</p>
			{armed ? (
				<Button
					className="w-full"
					onPress={() => onPick(null)}
					size="xs"
					variant="transparent"
				>
					Cancel
				</Button>
			) : null}
		</div>
	);
}
