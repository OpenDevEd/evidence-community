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
	Spinner,
	ModalContent,
	ModalFooter,
	ModalHeader,
} from "@nextui-org/react";
import { useState } from "react";
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

import { getAdminSourceIssues, setAdminSourceIssueDismissed } from "./admin-api";
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
	return count === null
		? ""
		: `, ${count.toLocaleString()} ${count === 1 ? "record" : "records"} ${suffix}`;
}

/** The plain sentences the dialog shows under the status line. */
function syncFacts(sync: AdminSourceSync) {
	const facts: string[] = [];
	if (sync.status === "running") {
		facts.push(
			`Running since ${formatTime(sync.runningSince)}${records(sync.processed, "processed so far")}.`,
		);
	}
	if (sync.lastSuccessAt) {
		facts.push(
			sync.lastRecords === 0
				? `Last checked ${formatTime(sync.lastSuccessAt)}. No new or changed records.`
				: `Last checked ${formatTime(sync.lastSuccessAt)}${records(sync.lastRecords, "processed")}.`,
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
	showDismissed,
	shown,
}: {
	data: AdminSourceIssuesPage | undefined;
	error: unknown;
	isLoading: boolean;
	showDismissed: boolean;
	shown: number;
}) {
	if (isLoading) return <Spinner aria-label="Loading issues" size="sm" />;
	if (error) return "Issues could not be loaded.";
	if (!data) return null;
	const total = showDismissed ? data.dismissedTotal : data.total;
	if (total === 0) {
		return showDismissed
			? "No dismissed issues."
			: "No open record issues.";
	}
	return `Showing ${shown.toLocaleString()} of ${total.toLocaleString()} ${showDismissed ? "dismissed" : "open"} issues.`;
}

/** Loads the issue list page by page, per view (open or dismissed), with dismiss and restore. */
function useSourceIssues(sourceKey: string, sync: AdminSourceSync) {
	const [showDismissed, setShowDismissed] = useState(false);
	// Pages after the first belong to one first-page result. A new first
	// page, from a view change or a poll, starts the list over so a row can
	// never show twice or linger after it was resolved.
	const [more, setMore] = useState<{
		after: AdminSourceIssuesPage | undefined;
		pages: AdminSourceIssuesPage[];
	}>({ after: undefined, pages: [] });
	const [busyKey, setBusyKey] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	// The key carries the polled status and count, and a running import
	// refetches on an interval, so the list follows what the import writes.
	const { data, error, isLoading, mutate } = useSWR(
		["admin-source-issues", sourceKey, showDismissed, sync.status, sync.issueCount] as const,
		([, key, dismissed]) => getAdminSourceIssues(key, { dismissed }),
		{ refreshInterval: sync.status === "running" ? ISSUES_POLL_MS : 0 },
	);
	const pages = data !== undefined && more.after === data ? more.pages : [];
	const last = pages.at(-1) ?? data;

	async function run(key: string, action: () => Promise<void>, fallback: string) {
		setBusyKey(key);
		try {
			await action();
			setActionError(null);
		} catch (caught) {
			setActionError(caught instanceof Error ? caught.message : fallback);
		} finally {
			setBusyKey(null);
		}
	}

	return {
		actionError,
		busyKey,
		data,
		error,
		hasMore: Boolean(last?.hasMore),
		isLoading,
		issues: [...(data?.issues ?? []), ...pages.flatMap((page) => page.issues)],
		loadMore: () =>
			run(
				"more",
				async () => {
					const cursor = last?.nextCursor;
					if (!cursor) return;
					const page = await getAdminSourceIssues(sourceKey, {
						cursor,
						dismissed: showDismissed,
					});
					setMore({ after: data, pages: [...pages, page] });
				},
				"More issues could not be loaded.",
			),
		setDismissed: (issue: AdminSourceIssue, dismissed: boolean) =>
			run(
				issue.sourceRecordKey,
				async () => {
					await setAdminSourceIssueDismissed(sourceKey, issue.sourceRecordKey, dismissed);
					setMore({ after: undefined, pages: [] });
					// The row leaves this view at once; the refresh only corrects
					// the counts, so a failed refresh cannot bring it back.
					await mutate(
						(current) =>
							current && {
								...current,
								dismissedTotal: current.dismissedTotal + (dismissed ? 1 : -1),
								issues: current.issues.filter(
									(entry) => entry.sourceRecordKey !== issue.sourceRecordKey,
								),
								total: current.total + (dismissed ? -1 : 1),
							},
						{ revalidate: true },
					);
				},
				"The issue could not be updated.",
			),
		showDismissed,
		toggleView: () => {
			setMore({ after: undefined, pages: [] });
			setShowDismissed((current) => !current);
		},
	};
}

/** Switches the list between open and dismissed issues once there is anything dismissed. */
function ViewToggle({
	data,
	onToggle,
	showDismissed,
}: {
	data: AdminSourceIssuesPage | undefined;
	onToggle: () => void;
	showDismissed: boolean;
}) {
	if (!data || (data.dismissedTotal === 0 && !showDismissed)) return null;
	return (
		<Button aria-pressed={showDismissed} onPress={onToggle} size="xs" variant="transparent">
			{showDismissed
				? `Show open (${data.total.toLocaleString()})`
				: `Show dismissed (${data.dismissedTotal.toLocaleString()})`}
		</Button>
	);
}

function SyncIssues({
	onIssuesChanged,
	onOpenRecord,
	sourceKey,
	sync,
}: {
	onIssuesChanged: () => void;
	onOpenRecord: (itemKey: string) => void;
	sourceKey: string;
	sync: AdminSourceSync;
}) {
	const list = useSourceIssues(sourceKey, sync);
	const notice = issuesNotice({
		data: list.data,
		error: list.error,
		isLoading: list.isLoading,
		showDismissed: list.showDismissed,
		shown: list.issues.length,
	});
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-2">
				<div
					aria-live="polite"
					className={`text-xs ${list.error ? "text-danger" : "text-black/55 dark:text-white/55"}`}
				>
					{notice}
				</div>
				<ViewToggle data={list.data} onToggle={list.toggleView} showDismissed={list.showDismissed} />
			</div>
			{list.actionError ? (
				<p className="text-xs text-danger" role="alert">
					{list.actionError}
				</p>
			) : null}
			{list.issues.length > 0 ? (
				<ul className="divide-y divide-black/[0.08] dark:divide-white/[0.09]" data-admin-source-issues>
					{list.issues.map((issue) => (
						<IssueRow
							busy={list.busyKey !== null}
							issue={issue}
							key={issue.sourceRecordKey}
							onOpenRecord={onOpenRecord}
							onSetDismissed={async (dismissed) => {
								await list.setDismissed(issue, dismissed);
								onIssuesChanged();
							}}
						/>
					))}
				</ul>
			) : null}
			{list.hasMore ? (
				<Button
					isDisabled={list.busyKey !== null}
					isLoading={list.busyKey === "more"}
					onPress={list.loadMore}
					size="xs"
					variant="transparent"
				>
					Load more
				</Button>
			) : null}
		</div>
	);
}

/**
 * What a saved issue means for the reader and what to do about it. One issue
 * can hold several failures (a dropped field and an unpublished file), and one
 * code can cover different causes, so the explanation reads the worker's
 * message. That message stays visible as a detail line.
 */
const issueExplanations: { next: string; test: RegExp; title: string }[] = [
	{
		test: /left out/u,
		title: "Some fields were left out",
		next: "The rest of the record was imported. Fix the named field in Zotero and the next import brings it in.",
	},
	{
		test: /exceeded the ingestion limit/u,
		title: "Record too large to import in full",
		next: "Only the type and title were kept. Shorten the record's text in Zotero.",
	},
	{
		test: /valid filename and MD5/u,
		title: "PDF not published",
		next: "Zotero has no uploaded copy of this file, or its filename is empty or longer than 255 characters. In Zotero, sync so the file uploads to group storage, or rename or re-attach the PDF. The next import retries it.",
	},
	{
		test: /linked URL must have a valid URL/u,
		title: "PDF not published",
		next: "The linked attachment has no web address. In Zotero, add the URL to the attachment.",
	},
	{
		test: /must have a parent item/u,
		title: "PDF not published",
		next: "The file is not attached to a record. In Zotero, move it under its parent record.",
	},
	{
		test: /linked_url, imported_file, or imported_url/u,
		title: "PDF not published",
		next: "The attachment is a linked local file. In Zotero, store the file in the group instead of linking to a path.",
	},
	{
		test: /not a processable PDF/u,
		title: "PDF not published",
		next: "The file is not a readable PDF. Replace the attachment in Zotero.",
	},
	{
		test: /\b413\b|too large|byte limit/u,
		title: "PDF not published",
		next: "The file is larger than the import allows. Reduce the PDF in Zotero, or remove the publish tag.",
	},
	{
		test: /\b404\b|not found|unavailable/u,
		title: "PDF not published",
		next: "Zotero could not provide the file. Check that it is a stored file in Zotero, then let the next import retry.",
	},
];

function explainIssue(issue: AdminSourceIssue) {
	const matched = issueExplanations.filter(({ test }) => test.test(issue.message));
	if (matched.length === 0) {
		return { next: issue.message, title: "Record not imported in full" };
	}
	return {
		next: matched.map(({ next }) => next).join(" "),
		title: [...new Set(matched.map(({ title }) => title))].join("; "),
	};
}

function IssueName({
	issue,
	name,
	onOpenRecord,
}: {
	issue: AdminSourceIssue;
	name: string;
	onOpenRecord: (itemKey: string) => void;
}) {
	if (!issue.itemKey) {
		return <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>;
	}
	const itemKey = issue.itemKey;
	return (
		<button
			className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline"
			onClick={() => onOpenRecord(itemKey)}
			type="button"
		>
			{name}
		</button>
	);
}

function IssueDetails({ issue, next }: { issue: AdminSourceIssue; next: string }) {
	return (
		<>
			{issue.attachmentFilename ? (
				<p className="break-all text-xs text-black/60 dark:text-white/60">
					File: {issue.attachmentFilename}
				</p>
			) : null}
			<p className="text-xs text-black/80 dark:text-white/80">{next}</p>
			<p className="text-xs text-black/60 dark:text-white/60">
				Details: {issue.message}
				{issue.dismissedAt ? ` · Dismissed ${formatTime(issue.dismissedAt)}` : ""}
			</p>
		</>
	);
}

function IssueRow({
	busy,
	issue,
	onOpenRecord,
	onSetDismissed,
}: {
	busy: boolean;
	issue: AdminSourceIssue;
	onOpenRecord: (itemKey: string) => void;
	onSetDismissed: (dismissed: boolean) => void;
}) {
	const explanation = explainIssue(issue);
	const dismissed = issue.dismissedAt !== null;
	const name = issue.title || (issue.itemKey ? "Untitled record" : issue.sourceRecordKey);
	const action = dismissed ? "Restore" : "Dismiss";
	return (
		<li
			className={`flex flex-col gap-1 py-2.5 ${dismissed ? "opacity-70" : ""}`}
			data-admin-source-issue-dismissed={dismissed ? "true" : undefined}
		>
			<div className="flex items-center gap-2">
				<IssueName issue={issue} name={name} onOpenRecord={onOpenRecord} />
				<span className="shrink-0 rounded border border-danger/40 px-1 text-xs text-danger">
					{explanation.title}
				</span>
				<Button
					aria-label={`${action} issue: ${name}`}
					isDisabled={busy}
					onPress={() => onSetDismissed(!dismissed)}
					size="xs"
					variant="transparent"
				>
					{action}
				</Button>
			</div>
			<IssueDetails issue={issue} next={explanation.next} />
		</li>
	);
}

/** The dialog body: import state, then the records with a saved issue. */
export function AdminSourceSyncPanel({
	onIssuesChanged,
	onOpenRecord,
	source,
	sync,
}: {
	/** Called after an issue was dismissed or restored, so the sidebar count follows. */
	onIssuesChanged: () => void;
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
				<SyncIssues
					onIssuesChanged={onIssuesChanged}
					onOpenRecord={onOpenRecord}
					sourceKey={source.key}
					sync={sync}
				/>
			</div>
		</>
	);
}

/** Import state and record issues of one external source. */
export function AdminSourceSyncDialog({
	onClose,
	onIssuesChanged,
	onOpenRecord,
	source,
}: {
	onClose: () => void;
	onIssuesChanged: () => void;
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
									onIssuesChanged={onIssuesChanged}
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
