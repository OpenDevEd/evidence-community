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
import type { AdminSearchIndexMutationResult } from "@/lib/admin/search-index-contract";

import { SourceProviderIcon } from "./SourceProviderIcon";
import { useAdminSourcesWriteback } from "./useAdminSourcesWriteback";
import {
	summarizeWritebackStates,
	writebackSummaryLabel,
} from "./writeback-summary";

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

export type AdminWritebackSourceSummary = {
	provider: string;
	sourceKey: string;
	sourceLabel: string;
};

/**
 * One chip for all the sources a record writes to. The chip shows the state
 * that needs attention most; the popover lists every source with its own
 * state and actions (retry, or the two conflict choices).
 */
export function AdminSourcesWritebackStatus({
	canLoadRemote,
	itemKey,
	onResolved,
	revision,
	sources,
}: {
	/** Attachments and notes follow their parent; only the parent may load the source's copy. */
	canLoadRemote: boolean;
	itemKey: string;
	/** Called after a conflict choice, so the record can be reloaded and search updates tracked. */
	onResolved: (result: AdminSearchIndexMutationResult) => void;
	revision: number | null;
	sources: readonly AdminWritebackSourceSummary[];
}) {
	const writeback = useAdminSourcesWriteback(
		itemKey,
		sources.map((source) => source.sourceKey),
		revision,
		onResolved,
	);
	// Both conflict choices lose data on one side, so each needs a second click.
	// The armed choice names its source and is dropped once that source is no
	// longer in conflict.
	const [pendingChoice, setPendingChoice] = useState<{
		choice: ConflictChoice;
		sourceKey: string;
	} | null>(null);
	const states = sources.map(
		(source) => writeback.entries[source.sourceKey]?.status?.state ?? null,
	);
	const loaded = states.some((state) => state !== null);
	const state = summarizeWritebackStates(states);
	const config = appearance[state];
	const Icon = !loaded && writeback.loading ? LoaderCircle : config.icon;
	const spin = (!loaded && writeback.loading) || config.spin;
	const label =
		!loaded && writeback.loading
			? "Checking sources"
			: writebackSummaryLabel(state, sources.length);

	return (
		<Popover placement="bottom-start">
			<PopoverTrigger>
				<button
					aria-label={`Sources: ${label}`}
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
					<p className="text-xs font-medium text-black/45 dark:text-white/45">
						Sources
					</p>
					<ul className="space-y-3">
						{sources.map((source) => {
							const entry = writeback.entries[source.sourceKey];
							const sourceState = entry?.status?.state ?? "idle";
							const sourceConfig = appearance[sourceState];
							const SourceIcon = sourceConfig.icon;
							const armed =
								pendingChoice?.sourceKey === source.sourceKey &&
								sourceState === "conflict"
									? pendingChoice.choice
									: null;
							const busy = writeback.busySource === source.sourceKey;
							return (
								<li
									className="space-y-2"
									data-admin-writeback-source={source.sourceKey}
									data-admin-writeback-source-status={sourceState}
									key={source.sourceKey}
								>
									<div className="flex items-start gap-2.5">
										<span className="mt-0.5 grid size-[15px] shrink-0 place-items-center text-black/55 dark:text-white/55">
											<SourceProviderIcon
												provider={source.provider}
												size={14}
											/>
										</span>
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-semibold text-black/85 dark:text-white/90">
												{source.sourceLabel}
											</p>
											<p
												className={`mt-0.5 inline-flex items-center gap-1 text-xs font-medium ${sourceConfig.className}`}
											>
												<SourceIcon
													aria-hidden
													className={sourceConfig.spin ? "animate-spin" : undefined}
													size={12}
												/>
												{sourceConfig.label}
											</p>
											<p className="mt-1 text-xs leading-5 text-black/55 dark:text-white/55">
												{sourceConfig.description}
											</p>
										</div>
									</div>
									{entry?.error || entry?.status?.error ? (
										<p
											className="rounded-lg bg-danger/[0.07] px-2.5 py-2 text-xs leading-5 text-danger"
											role="alert"
										>
											{entry.error ?? entry.status?.error}
										</p>
									) : null}
									{sourceState === "conflict" ? (
										<div className="space-y-2" data-admin-writeback-conflict>
											<ConflictChoiceButton
												choice="send-local"
												description={`Replaces the ${source.sourceLabel} copy with this record. Changes made in ${source.sourceLabel} while updates were paused are lost there.`}
												disabled={busy}
												label={`Send this record to ${source.sourceLabel}`}
												onConfirm={() => {
													setPendingChoice(null);
													void writeback.resolve(source.sourceKey, "send-local");
												}}
												onPick={(choice) =>
													setPendingChoice(
														choice ? { choice, sourceKey: source.sourceKey } : null,
													)
												}
												pending={armed}
											/>
											{canLoadRemote ? (
												<ConflictChoiceButton
													choice="load-remote"
													description={`Replaces this record with the ${source.sourceLabel} copy. Unpublished local changes are lost.`}
													disabled={busy}
													label={`Load ${source.sourceLabel}’s version`}
													onConfirm={() => {
														setPendingChoice(null);
														void writeback.resolve(source.sourceKey, "load-remote");
													}}
													onPick={(choice) =>
														setPendingChoice(
															choice ? { choice, sourceKey: source.sourceKey } : null,
														)
													}
													pending={armed}
												/>
											) : null}
										</div>
									) : sourceState === "failed" ? (
										<Button
											className="w-full"
											color="accent"
											isDisabled={busy}
											onPress={() => void writeback.retry(source.sourceKey)}
											size="xs"
											startContent={
												<RefreshCw
													aria-hidden
													className={busy ? "animate-spin" : undefined}
													size={14}
												/>
											}
											variant="solid"
										>
											Retry writeback
										</Button>
									) : entry?.error ? (
										<Button
											className="w-full"
											onPress={() => void writeback.refresh()}
											size="xs"
											startContent={<RefreshCw aria-hidden size={14} />}
										>
											Check again
										</Button>
									) : null}
								</li>
							);
						})}
					</ul>
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
