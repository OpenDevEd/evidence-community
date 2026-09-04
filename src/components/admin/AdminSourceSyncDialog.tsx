"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import {
	AlertCircleIcon,
	CheckmarkCircle02Icon,
	Clock01Icon,
	Loading03Icon,
} from "@hugeicons/core-free-icons";
import {
	ModalBody,
	ModalContent,
	ModalFooter,
	ModalHeader,
} from "@nextui-org/react";
import useSWR from "swr";

import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import type {
	AdminSource,
	AdminSourceIssue,
	AdminSourceIssuesPage,
	AdminSourceSync,
	AdminSourceSyncStatus,
} from "@/lib/admin/types";

import { getAdminSourceIssues } from "./admin-api";
import { SourceProviderIcon } from "./SourceProviderIcon";

const appearance: Record<
	AdminSourceSyncStatus,
	{ className: string; icon: typeof Clock01Icon; label: string; spin: boolean }
> = {
	failed: {
		className: "text-danger",
		icon: AlertCircleIcon,
		label: "Last import failed",
		spin: false,
	},
	idle: {
		className: "text-black/35 dark:text-white/35",
		icon: Clock01Icon,
		label: "Not imported yet",
		spin: false,
	},
	running: {
		className: "text-accent",
		icon: Loading03Icon,
		label: "Importing",
		spin: true,
	},
	succeeded: {
		className: "text-emerald-600 dark:text-emerald-400",
		icon: CheckmarkCircle02Icon,
		label: "Imported",
		spin: false,
	},
};

const ISSUES_POLL_MS = 10_000;

function formatTime(value: string | null) {
	if (!value) return null;
	return new Date(value).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

function syncDescription(sync: AdminSourceSync) {
	const issues =
		sync.issueCount > 0
			? `, ${sync.issueCount} ${sync.issueCount === 1 ? "record issue" : "record issues"}`
			: "";
	return `${appearance[sync.status].label}${issues}`;
}

/** The small status button shown next to a source in the sidebar. */
export function AdminSourceSyncBadge({
	label,
	onClick,
	sync,
}: {
	label: string;
	onClick: () => void;
	sync: AdminSourceSync;
}) {
	const look = appearance[sync.status];
	return (
		<button
			aria-label={`${label} import: ${syncDescription(sync)}`}
			className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium hover:bg-black/[0.05] dark:hover:bg-white/[0.06] ${look.className}`}
			data-admin-source-sync={sync.status}
			onClick={onClick}
			title={syncDescription(sync)}
			type="button"
		>
			<HugeiconsIcon
				aria-hidden
				className={look.spin ? "animate-spin" : undefined}
				icon={look.icon}
				size={13}
			/>
			{sync.issueCount > 0 ? <span>{sync.issueCount}</span> : null}
		</button>
	);
}

function records(count: number | null, suffix: string) {
	return count === null ? "" : `, ${count.toLocaleString()} ${suffix}`;
}

/** The plain sentences the dialog shows under the status line. */
function syncFacts(sync: AdminSourceSync) {
	const facts: string[] = [];
	if (sync.status === "running") {
		facts.push(
			`Running since ${formatTime(sync.runningSince)}${records(sync.processed, "records processed so far")}.`,
		);
	}
	if (sync.lastSuccessAt) {
		facts.push(
			`Last successful import ${formatTime(sync.lastSuccessAt)}${records(sync.lastRecords, "records")}.`,
		);
	}
	if (sync.lastFailureAt) {
		facts.push(`Last failure ${formatTime(sync.lastFailureAt)}.`);
	}
	return facts;
}

function SyncFacts({ sync }: { sync: AdminSourceSync }) {
	const look = appearance[sync.status];
	return (
		<div aria-live="polite" className="flex flex-col gap-1.5">
			<p className={`flex items-center gap-1.5 text-sm font-medium ${look.className}`}>
				<HugeiconsIcon
					aria-hidden
					className={look.spin ? "animate-spin" : undefined}
					icon={look.icon}
					size={15}
				/>
				{look.label}
			</p>
			{syncFacts(sync).map((fact) => (
				<p className="text-xs text-black/60 dark:text-white/60" key={fact}>
					{fact}
				</p>
			))}
			{sync.lastError ? (
				<pre className="whitespace-pre-wrap break-words rounded-lg bg-danger/10 p-2 text-[11px] text-danger">
					{sync.lastError}
				</pre>
			) : null}
		</div>
	);
}

function issuesNotice({
	data,
	error,
	isLoading,
}: {
	data: AdminSourceIssuesPage | undefined;
	error: unknown;
	isLoading: boolean;
}) {
	if (isLoading) return "Loading issues…";
	if (error) return "Issues could not be loaded.";
	if (!data || data.issues.length === 0) {
		return "No record issues. Every record was stored in full.";
	}
	if (data.total > data.issues.length) {
		return `Showing the newest ${data.issues.length.toLocaleString()} of ${data.total.toLocaleString()} issues.`;
	}
	return null;
}

function SyncIssues({
	onOpenRecord,
	sourceKey,
	sync,
}: {
	onOpenRecord: (itemKey: string) => void;
	sourceKey: string;
	sync: AdminSourceSync;
}) {
	// The key carries the polled status and count, and a running import
	// refetches on an interval, so the list follows what the import writes.
	const { data, error, isLoading } = useSWR(
		["admin-source-issues", sourceKey, sync.status, sync.issueCount] as const,
		([, key]) => getAdminSourceIssues(key),
		{
			keepPreviousData: true,
			refreshInterval: sync.status === "running" ? ISSUES_POLL_MS : 0,
		},
	);
	const notice = issuesNotice({ data, error, isLoading });
	return (
		<div>
			<p
				aria-live="polite"
				className={`text-xs ${error ? "text-danger" : "text-black/55 dark:text-white/55"}`}
			>
				{notice}
			</p>
			{data && data.issues.length > 0 ? (
				<IssueList issues={data.issues} onOpenRecord={onOpenRecord} />
			) : null}
		</div>
	);
}

function IssueList({
	issues,
	onOpenRecord,
}: {
	issues: AdminSourceIssue[];
	onOpenRecord: (itemKey: string) => void;
}) {
	return (
		<ul className="divide-y divide-black/[0.08] dark:divide-white/[0.09]" data-admin-source-issues>
			{issues.map((issue) => (
				<li className="flex flex-col gap-0.5 py-2" key={issue.sourceRecordKey}>
					<div className="flex items-center gap-2">
						{issue.itemKey ? (
							<button
								className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
								onClick={() => onOpenRecord(issue.itemKey!)}
								type="button"
							>
								{issue.title || "Untitled record"}
							</button>
						) : (
							<span className="min-w-0 flex-1 truncate text-sm font-medium">
								{issue.title || issue.sourceRecordKey}
							</span>
						)}
						<span className="shrink-0 rounded border border-black/15 px-1 text-xs text-black/60 dark:border-white/15 dark:text-white/60">
							{issue.code}
						</span>
					</div>
					<p className="text-xs text-black/60 dark:text-white/60">{issue.message}</p>
				</li>
			))}
		</ul>
	);
}

/** The dialog body: import state, then the records with a saved issue. */
export function AdminSourceSyncPanel({
	onOpenRecord,
	source,
	sync,
}: {
	onOpenRecord: (itemKey: string) => void;
	source: AdminSource;
	sync: AdminSourceSync;
}) {
	return (
		<>
			<SyncFacts sync={sync} />
			<div>
				<p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-black/40 dark:text-white/40">
					Record issues
				</p>
				<SyncIssues onOpenRecord={onOpenRecord} sourceKey={source.key} sync={sync} />
			</div>
		</>
	);
}

/** Import state and record issues of one external source. */
export function AdminSourceSyncDialog({
	onClose,
	onOpenRecord,
	source,
}: {
	onClose: () => void;
	onOpenRecord: (itemKey: string) => void;
	source: AdminSource | null;
}) {
	return (
		<DialogModal
			isOpen={Boolean(source?.sync)}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
			scrollBehavior="inside"
			size="md"
		>
			<ModalContent>
				{(close) =>
					source?.sync ? (
						<>
							<ModalHeader className="flex items-center gap-2">
								<SourceProviderIcon provider={source.provider} size={17} />
								<span className="truncate">{source.label}</span>
							</ModalHeader>
							<ModalBody className="gap-4">
								<AdminSourceSyncPanel
									onOpenRecord={onOpenRecord}
									source={source}
									sync={source.sync}
								/>
							</ModalBody>
							<ModalFooter>
								<Button onPress={close} size="xs" variant="transparent">
									Close
								</Button>
							</ModalFooter>
						</>
					) : null
				}
			</ModalContent>
		</DialogModal>
	);
}
