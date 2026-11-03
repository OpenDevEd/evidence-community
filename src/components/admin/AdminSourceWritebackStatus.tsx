"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import {
	AlertCircleIcon,
	CheckmarkCircle01Icon,
	Clock03Icon,
	CloudLoadingIcon,
	CloudOffIcon,
	CloudUploadIcon,
	GitCompareIcon,
	Loading03Icon,
	SquareLock01Icon,
	PauseIcon,
	Refresh01Icon,
	UnplugIcon,
} from "@hugeicons/core-free-icons";
import { useState, type ReactNode } from "react";
import { AdminStatusAccordion } from "./AdminStatusAccordion";
import { Tooltip } from "@/components/nextui/Tooltip";

import { Button } from "@/components/nextui/Button";
import type { AdminSearchIndexMutationResult } from "@/lib/admin/search-index-contract";

import { useAdminSession } from "./AdminSessionProvider";
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
		icon: GitCompareIcon,
		label: "Needs a decision",
		spin: false,
	},
	disabled: {
		className: "text-black/45 dark:text-white/45",
		description:
			"Writeback is disabled for this source in the community configuration.",
		icon: CloudOffIcon,
		label: "Writeback off",
		spin: false,
	},
	failed: {
		className: "text-danger",
		description: "The last writeback attempt failed and needs attention.",
		icon: AlertCircleIcon,
		label: "Sync failed",
		spin: false,
	},
	idle: {
		className: "text-black/45 dark:text-white/45",
		description: "Published edits will be written back to this source.",
		icon: CloudUploadIcon,
		label: "Writeback ready",
		spin: false,
	},
	locked: {
		className: "text-black/45 dark:text-white/45",
		description: "Writeback is locked for this record.",
		icon: SquareLock01Icon,
		label: "Writeback locked",
		spin: false,
	},
	paused: {
		className: "text-amber-700 dark:text-amber-300",
		description: "This source is paused. Queued edits will wait.",
		icon: PauseIcon,
		label: "Source paused",
		spin: false,
	},
	queued: {
		className: "text-accent-300 dark:text-accent-700",
		description: "The edit is queued for writeback.",
		icon: Clock03Icon,
		label: "Waiting to sync",
		spin: false,
	},
	removed: {
		className: "text-danger",
		description: "This record's source has been removed.",
		icon: UnplugIcon,
		label: "Source removed",
		spin: false,
	},
	retrying: {
		className: "text-amber-700 dark:text-amber-300",
		description:
			"Writeback hit a temporary error and will retry automatically.",
		icon: Refresh01Icon,
		label: "Retrying sync",
		spin: true,
	},
	sending: {
		className: "text-accent-300 dark:text-accent-700",
		description: "The edit is being written back now.",
		icon: Loading03Icon,
		label: "Syncing",
		spin: true,
	},
	synced: {
		className: "text-emerald-700 dark:text-emerald-300",
		description:
			"The latest published edit was acknowledged by the source.",
		icon: CheckmarkCircle01Icon,
		label: "Synced",
		spin: false,
	},
	unsupported: {
		className: "text-black/45 dark:text-white/45",
		description: "This source type does not support writeback.",
		icon: CloudLoadingIcon,
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

type Writeback = ReturnType<typeof useAdminSourcesWriteback>;
type WritebackState = keyof typeof appearance;

function writebackSummaryIcon(
	state: WritebackState,
	unavailable: boolean,
	checking: boolean,
) {
	if (unavailable) return AlertCircleIcon;
	if (checking) return Loading03Icon;
	return appearance[state].icon;
}

function writebackSummaryText(
	state: WritebackState,
	sourceCount: number,
	unavailable: boolean,
	checking: boolean,
) {
	if (unavailable) return "Status unavailable";
	if (checking) return "Checking sources";
	if (state === "synced") return `${sourceCount} synced`;
	return appearance[state].label;
}

function writebackSummaryTitle(
	label: string,
	state: WritebackState,
	sourceCount: number,
	unavailable: boolean,
	checking: boolean,
) {
	if (unavailable || checking) return label;
	return writebackSummaryLabel(state, sourceCount);
}

function sourceWritebackStates(
	sources: readonly AdminWritebackSourceSummary[],
	writeback: Writeback,
) {
	return sources.map(
		(source) => writeback.entries[source.sourceKey]?.status?.state ?? null,
	);
}

function hasUnavailableSource(
	sources: readonly AdminWritebackSourceSummary[],
	writeback: Writeback,
) {
	return sources.some((source) =>
		Boolean(writeback.entries[source.sourceKey]?.error),
	);
}

function getWritebackSummary(
	sources: readonly AdminWritebackSourceSummary[],
	writeback: Writeback,
) {
	const states = sourceWritebackStates(sources, writeback);
	const state = summarizeWritebackStates(states);
	const config = appearance[state];
	const checking =
		!states.some((sourceState) => sourceState !== null) && writeback.loading;
	const unavailable = hasUnavailableSource(sources, writeback);
	const label = writebackSummaryText(
		state,
		sources.length,
		unavailable,
		checking,
	);

	return {
		Icon: writebackSummaryIcon(state, unavailable, checking),
		className: unavailable ? "text-danger" : config.className,
		label,
		spin: !unavailable && (checking || config.spin),
		title: writebackSummaryTitle(
			label,
			state,
			sources.length,
			unavailable,
			checking,
		),
	};
}

function AdminWritebackSummary({
	sources,
	writeback,
}: {
	sources: readonly AdminWritebackSourceSummary[];
	writeback: Writeback;
}) {
	const { Icon, className, label, spin, title } = getWritebackSummary(
		sources,
		writeback,
	);
	return (
		<Tooltip content={title}>
			<span
				aria-label={label}
				className={`inline-flex items-center gap-1.5 text-[11px] ${className}`}
			>
				<HugeiconsIcon
					icon={Icon}
					size={13}
					className={
						spin ? "animate-spin motion-reduce:animate-none" : undefined
					}
				/>
				{label}
			</span>
		</Tooltip>
	);
}

/** Per-source status and recovery actions. */
/** States whose meaning is already clear from the label; no tooltip, so no keyboard stop. */
const SILENT_STATES = new Set<keyof typeof appearance>(["sending", "queued", "removed", "locked"]);

function SourceStatusPill({ state, sourceLabel }: { state: keyof typeof appearance; sourceLabel: string }) {
	const config = appearance[state];
	const silent = SILENT_STATES.has(state);
	return (
		<Tooltip
			isDisabled={silent}
			content={`${config.label}. ${config.description}`}
			classNames={{
				content:
					"max-w-[min(16rem,calc(100vw-2rem))] whitespace-normal break-words text-xs leading-5",
			}}
			placement="left"
		>
			<span
				tabIndex={silent ? undefined : 0}
				aria-label={`${sourceLabel}: ${config.label}`}
				className={`inline-flex shrink-0 items-center gap-1 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-focus ${config.className}`}
			>
				<HugeiconsIcon icon={config.icon} size={13} className={config.spin ? "animate-spin" : undefined} />
				{config.label}
			</span>
		</Tooltip>
	);
}

export function AdminSourcesWritebackStatus({
	canLoadRemote,
	sources,
	itemKey,
	revision,
	onResolved,
	manageAction,
	restriction,
}: {
	canLoadRemote: boolean;
	manageAction?: ReactNode;
	restriction?: string;
	sources: readonly AdminWritebackSourceSummary[];
	itemKey: string;
	revision: number | null;
	onResolved: (result: AdminSearchIndexMutationResult) => void;
}) {
	const { canPublish } = useAdminSession();
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

	return (
		<section
			data-admin-writeback-status={summarizeWritebackStates(states)}
			aria-label="Connected sources"
		>
			<AdminStatusAccordion
				title="Sources"
				action={manageAction}
				summary={
					restriction ? (
						<span className="inline-flex items-center gap-1.5 text-black/55 dark:text-white/55">
							<HugeiconsIcon icon={SquareLock01Icon} size={12} />
							{restriction ===
							"Writeback is locked for this record."
								? "Writeback locked"
								: "Writeback restricted"}
						</span>
					) : sources.length ? (
						<AdminWritebackSummary
							sources={sources}
							writeback={writeback}
						/>
					) : (
						<span className="inline-flex items-center gap-1.5 text-black/55 dark:text-white/55">
							<HugeiconsIcon icon={UnplugIcon} size={12} />
							No connected sources
						</span>
					)
				}
			>
				{!restriction && sources.length === 0 && (
					<p className="py-1 text-xs leading-5 text-black/60 dark:text-white/60">
						This record is not connected to any source. Changes stay in this community{manageAction ? " unless you connect one with Manage" : ""}.
					</p>
				)}

				{restriction && (
					<div className="mb-3 flex items-start gap-2.5 py-1 text-black/60 dark:text-white/60">
						<span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-black/[0.045] dark:bg-white/[0.06]">
							<HugeiconsIcon icon={SquareLock01Icon} size={14} />
						</span>
						<p className="min-w-0 flex-1 py-1 text-xs leading-5">
							{restriction}
						</p>
					</div>
				)}
				<ul className="space-y-1">
					{sources.map((source) => {
						const entry = writeback.entries[source.sourceKey];
						const sourceState = entry?.status?.state ?? "idle";
						const armed =
							pendingChoice?.sourceKey === source.sourceKey &&
							sourceState === "conflict"
								? pendingChoice.choice
								: null;
						const busy = writeback.busySource === source.sourceKey;
						const controlsDisabled = busy || !canPublish;
						return (
							<li
								className="space-y-2"
								data-admin-writeback-source={source.sourceKey}
								data-admin-writeback-source-status={sourceState}
								key={source.sourceKey}
							>
								<div className="flex min-h-8 items-center gap-2 py-1">
									<span className="grid size-5 shrink-0 place-items-center text-black/55 dark:text-white/60">
										<SourceProviderIcon
											provider={source.provider}
											size={18}
										/>
									</span>
									<p className="min-w-0 flex-1 text-xs font-medium leading-5 text-black/85 dark:text-white/90">
										{source.sourceLabel}
									</p>
									<SourceStatusPill state={sourceState} sourceLabel={source.sourceLabel} />
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
									<div
										className="space-y-2"
										data-admin-writeback-conflict
									>
										<ConflictChoiceButton
											choice="send-local"
											description={`Replaces the ${source.sourceLabel} copy with the published version. Changes made in ${source.sourceLabel} while updates were paused are lost there.`}
											disabled={controlsDisabled}
											label={`Send this record to ${source.sourceLabel}`}
											onConfirm={() => {
												setPendingChoice(null);
												void writeback.resolve(
													source.sourceKey,
													"send-local",
												);
											}}
											onPick={(choice) =>
												setPendingChoice(
													choice
														? {
																choice,
																sourceKey:
																	source.sourceKey,
															}
														: null,
												)
											}
											pending={armed}
										/>
										{canLoadRemote ? (
											<ConflictChoiceButton
												choice="load-remote"
												description={`Replaces published metadata with the ${source.sourceLabel} copy. Working drafts stay private.`}
												disabled={controlsDisabled}
												label={`Load ${source.sourceLabel}’s version`}
												onConfirm={() => {
													setPendingChoice(null);
													void writeback.resolve(
														source.sourceKey,
														"load-remote",
													);
												}}
												onPick={(choice) =>
													setPendingChoice(
														choice
															? {
																	choice,
																	sourceKey:
																		source.sourceKey,
																}
															: null,
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
										isDisabled={controlsDisabled}
										onPress={() =>
											void writeback.retry(
												source.sourceKey,
											)
										}
										size="xs"
										startContent={
											<HugeiconsIcon
												icon={Refresh01Icon}
												aria-hidden
												className={
													busy
														? "animate-spin"
														: undefined
												}
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
										startContent={
											<HugeiconsIcon
												icon={Refresh01Icon}
												aria-hidden
												size={14}
											/>
										}
									>
										Check again
									</Button>
								) : null}
							</li>
						);
					})}
				</ul>
			</AdminStatusAccordion>
		</section>
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
				className="h-auto min-h-8 w-full whitespace-normal rounded-lg py-2 text-left"
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
