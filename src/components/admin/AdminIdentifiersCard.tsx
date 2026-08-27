"use client";

import { Tooltip } from "@/components/nextui/Tooltip";
import { Button } from "@/components/nextui/Button";
import type {
	AdminIdentifiersAction,
	AdminIdentifiersActionId,
	AdminIdentifiersActivity,
	AdminIdentifiersView,
	AdminPublicationProviderView,
} from "@/lib/publication/admin-publication-view";
import {
	AlertCircle,
	Archive,
	BadgeCheck,
	ChevronDown,
	Circle,
	CircleCheck,
	Clock3,
	Copy,
	ExternalLink,
	FileText,
	LoaderCircle,
	RefreshCw,
	Wrench,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { validationTargetId } from "./admin-validation";

const appearance = {
	blocked: { icon: AlertCircle, className: "text-amber-600 dark:text-amber-300", spin: false },
	external: { icon: CircleCheck, className: "text-black/50 dark:text-white/50", spin: false },
	failed: { icon: AlertCircle, className: "text-danger", spin: false },
	inactive: { icon: Circle, className: "text-black/35 dark:text-white/35", spin: false },
	queued: { icon: Clock3, className: "text-accent", spin: false },
	repair_pending: { icon: Wrench, className: "text-amber-600 dark:text-amber-300", spin: false },
	retrying: { icon: RefreshCw, className: "text-accent", spin: true },
	synced: { icon: CircleCheck, className: "text-emerald-600 dark:text-emerald-300", spin: false },
	verifying: { icon: LoaderCircle, className: "text-accent", spin: true },
	waiting: { icon: Clock3, className: "text-amber-600 dark:text-amber-300", spin: false },
	working: { icon: LoaderCircle, className: "text-accent", spin: true },
} as const;

const originLabel = {
	crossref: "registered here",
	zenodo: "from Zenodo",
	source: "from a source",
	record: "on the record",
} as const;

const confirmLabel: Record<AdminIdentifiersActionId, string> = {
	"register-crossref": "Activate Crossref DOI",
	"archive-zenodo": "Publish to Zenodo",
	"mint-zenodo": "Publish to Zenodo",
};

/** One short line for the closed card. */
function identifiersGlance(view: AdminIdentifiersView) {
	const doi = view.doi ? view.doi.value : "No DOI";
	const archiveRecord =
		view.archive.state === "active"
			? view.archive.links.find((link) => link.kind === "record")
			: null;
	const archiveState =
		view.archive.state === "active"
			? view.archive.displayState === "synced"
				? `Archived on Zenodo${archiveRecord ? ` · record ${archiveRecord.value}` : ""}`
				: view.archive.status.label
			: "Not archived";
	const archive = view.doi
		? `DOI ${originLabel[view.doi.origin]} · ${archiveState}`
		: archiveState;
	return { archive, doi };
}

function copy(label: string, value: string) {
	void navigator.clipboard
		.writeText(value)
		.then(() => toast.success(`${label} copied`))
		.catch(() => toast.error(`Could not copy ${label.toLowerCase()}`));
}

function ActivityDetails({
	activity,
	provider,
}: {
	activity: Extract<AdminIdentifiersActivity, { state: "active" }>;
	provider: AdminPublicationProviderView;
}) {
	return (
		<>
			{provider.blockers.length > 0 ? (
				<ul className="mt-1.5 space-y-1 text-xs text-black/55 dark:text-white/55">
					{provider.blockers.map((blocker) => (
						<li key={blocker}>• {blocker}</li>
					))}
				</ul>
			) : null}
			{activity.links.length > 0 ? (
				<div className="mt-2 space-y-1.5">
					{activity.links.map((link) => (
						<div key={`${link.kind}:${link.value}`} className="flex min-w-0 items-center gap-1.5">
							<a className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-black/65 underline decoration-black/15 underline-offset-2 hover:decoration-black/40 dark:text-white/70 dark:decoration-white/20 dark:hover:decoration-white/50" href={link.url} rel="noreferrer" target="_blank">
								{link.kind === "doi" ? link.value : link.label}
							</a>
							<Tooltip content={`Copy ${link.label}`}>
								<Button aria-label={`Copy ${link.label}`} isIconOnly onPress={() => copy(link.label, link.kind === "doi" ? link.value : link.url)} size="xs" variant="transparent">
									<Copy aria-hidden size={13} />
								</Button>
							</Tooltip>
						</div>
					))}
				</div>
			) : null}
		</>
	);
}

function ActivityControls({
	busy,
	onOpenAttachments,
	onRetry,
	provider,
}: {
	busy: boolean;
	onOpenAttachments: () => void;
	onRetry: () => void;
	provider: AdminPublicationProviderView;
}) {
	const policy = provider.exact.identifierPolicy;
	return (
		<div className="mt-2 flex flex-wrap items-center gap-1.5">
			{provider.capabilities.canRetry ? (
				<Button isDisabled={busy} onPress={onRetry} size="xs" startContent={<RefreshCw aria-hidden size={13} />} variant="transparent">
					Retry now
				</Button>
			) : null}
			{provider.waitingOn === "file" ? (
				<Button onPress={onOpenAttachments} size="xs" startContent={<FileText aria-hidden size={13} />} variant="transparent">
					Open attachments
				</Button>
			) : null}
			{policy ? (
				<span className="text-[11px] text-black/40 dark:text-white/40">
					{policy === "reuse-crossref"
						? "Uses the Crossref DOI"
						: policy === "reuse-external"
							? "Uses the record's own DOI"
							: "Uses Zenodo DOIs"}
				</span>
			) : null}
		</div>
	);
}

function ActivityRow({
	activity,
	busy,
	onOpenAttachments,
	onRetry,
	provider,
	title,
}: {
	activity: Extract<AdminIdentifiersActivity, { state: "active" }>;
	busy: boolean;
	onOpenAttachments: () => void;
	onRetry: () => void;
	provider: AdminPublicationProviderView;
	title: string;
}) {
	const look = appearance[activity.displayState];
	const Icon = look.icon;
	const failed = activity.displayState === "failed";
	return (
		<div
			className="flex items-start gap-3 py-3"
			data-admin-publication-provider={activity.provider}
			role={failed ? "alert" : undefined}
		>
			<span className={`mt-0.5 grid size-4 shrink-0 place-items-center ${look.className}`}>
				<Icon aria-hidden className={look.spin ? "animate-spin" : undefined} size={16} strokeWidth={2} />
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
					<p className="text-sm font-semibold text-black/85 dark:text-white/90">{title}</p>
					<span className={`text-xs font-semibold ${look.className}`} aria-live="polite">
						{activity.status.label}
					</span>
				</div>
				<p className="mt-1 text-xs leading-5 text-black/55 dark:text-white/55">{activity.status.description}</p>
				<ActivityDetails activity={activity} provider={provider} />
				<ActivityControls busy={busy} onOpenAttachments={onOpenAttachments} onRetry={onRetry} provider={provider} />
			</div>
		</div>
	);
}

function Readiness({
	action,
	busy,
	itemKey,
	onClose,
	onConfirm,
	onGoToField,
}: {
	action: AdminIdentifiersAction;
	busy: boolean;
	itemKey: string;
	onClose: () => void;
	onConfirm: () => void;
	onGoToField: (field: string) => void;
}) {
	const missing = action.readiness.filter((item) => !item.ok).length;
	const verb = action.id === "register-crossref" ? "registering" : "archiving";
	return (
		<div className="rounded-xl bg-black/[0.03] p-3 dark:bg-white/[0.04]">
			<div className="flex items-start justify-between gap-2">
				<div>
					<p className="text-sm font-semibold text-black/85 dark:text-white/90">{action.label}</p>
					<p className="text-[11px] text-black/40 dark:text-white/40">Checks before sending</p>
				</div>
				<Button aria-label="Close checklist" isIconOnly onPress={onClose} size="xs" variant="transparent">
					<X aria-hidden size={14} />
				</Button>
			</div>
			<ul aria-label={`Before ${verb}`} className="mt-2 space-y-1.5 text-xs">
				{action.readiness.map((item) => {
					const target = item.field ? validationTargetId(itemKey, item.field) : null;
					return (
						<li key={item.label} className="flex items-start gap-2 text-black/70 dark:text-white/70">
							{item.ok ? (
								<CircleCheck aria-label="Done" className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-300" size={14} />
							) : (
								<Circle aria-label="To do" className="mt-0.5 shrink-0 text-black/35 dark:text-white/35" size={14} />
							)}
							<span className="min-w-0 flex-1">
								{item.label}
								{!item.ok && target ? (
									<>
										{" "}
										<button
											className="text-accent underline underline-offset-2"
											onClick={() => onGoToField(item.field!)}
											type="button"
										>
											Go to field
										</button>
									</>
								) : null}
							</span>
						</li>
					);
				})}
			</ul>
			<div className="mt-3 flex items-center justify-between gap-2">
				<Button color="accent" isDisabled={busy || !action.ready || !action.available} onPress={onConfirm} size="xs" variant="solid">
					{confirmLabel[action.id]}
				</Button>
				{!action.available ? (
					<span className="text-[11px] text-black/40 dark:text-white/40">Not available here</span>
				) : missing > 0 ? (
					<span className="text-[11px] text-black/40 dark:text-white/40">
						{missing} {missing === 1 ? "thing" : "things"} to add first
					</span>
				) : null}
			</div>
		</div>
	);
}

function attentionLabel(identifiers: AdminIdentifiersView) {
	if (!identifiers.attention) return identifiersGlance(identifiers).archive;
	if (
		identifiers.registration.state === "active" &&
		identifiers.registration.displayState === "failed"
	) {
		return "Registration needs attention";
	}
	return "Archive needs attention";
}

function IdentifiersHeader({
	bodyId,
	identifiers,
	onToggle,
	open,
	toggleId,
}: {
	bodyId: string;
	identifiers: AdminIdentifiersView;
	onToggle: () => void;
	open: boolean;
	toggleId: string;
}) {
	const glance = identifiersGlance(identifiers);
	const GlanceIcon = identifiers.attention
		? AlertCircle
		: identifiers.doi
			? BadgeCheck
			: Circle;
	const iconColor = identifiers.attention
		? "text-danger"
		: identifiers.doi
			? "text-emerald-600 dark:text-emerald-300"
			: "text-black/35 dark:text-white/35";
	return (
		<button
			aria-controls={bodyId}
			aria-expanded={open}
			className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-black/[0.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:hover:bg-white/[0.03]"
			onClick={onToggle}
			id={toggleId}
			type="button"
		>
			<span className={`grid size-4 shrink-0 place-items-center ${iconColor}`}>
				<GlanceIcon aria-hidden size={16} strokeWidth={2} />
			</span>
			<span className="min-w-0 flex-1">
				<span
					className={`block truncate text-sm font-semibold ${identifiers.doi ? "font-mono" : ""} text-black/85 dark:text-white/90`}
				>
					{glance.doi}
				</span>
				<span
					className={`block text-[11px] ${identifiers.attention ? "text-danger" : "text-black/45 dark:text-white/45"}`}
				>
					{attentionLabel(identifiers)}
				</span>
			</span>
			<ChevronDown
				aria-hidden
				className={`shrink-0 text-black/40 transition-transform dark:text-white/40 ${open ? "rotate-180" : ""}`}
				size={16}
			/>
		</button>
	);
}

function IdentifierDoi({ doi }: { doi: NonNullable<AdminIdentifiersView["doi"]> }) {
	return (
		<div className="flex items-center gap-2 py-3">
			<div className="min-w-0 flex-1">
				<p className="text-[11px] text-black/40 dark:text-white/40">
					DOI · {originLabel[doi.origin]}
				</p>
				<a
					className="block truncate font-mono text-sm font-medium text-black/80 underline decoration-black/15 underline-offset-2 dark:text-white/85 dark:decoration-white/20"
					href={doi.url}
					rel="noreferrer"
					target="_blank"
				>
					{doi.value}
				</a>
			</div>
			<Tooltip content="Copy DOI">
				<Button
					aria-label="Copy DOI"
					isIconOnly
					onPress={() => copy("DOI", doi.value)}
					size="xs"
					variant="transparent"
				>
					<Copy aria-hidden size={13} />
				</Button>
			</Tooltip>
			<Tooltip content="Open DOI">
				<Button
					as="a"
					aria-label="Open DOI"
					href={doi.url}
					isIconOnly
					rel="noreferrer"
					size="xs"
					target="_blank"
					variant="transparent"
				>
					<ExternalLink aria-hidden size={13} />
				</Button>
			</Tooltip>
		</div>
	);
}

function IdentifierActions({
	actions,
	busy,
	itemKey,
	onActivate,
	onGoToField,
	picked,
	setPicked,
}: {
	actions: readonly AdminIdentifiersAction[];
	busy: boolean;
	itemKey: string;
	onActivate: (action: AdminIdentifiersActionId) => void;
	onGoToField: (field: string) => void;
	picked: AdminIdentifiersActionId | null;
	setPicked: (action: AdminIdentifiersActionId | null) => void;
}) {
	if (actions.length === 0) return null;
	const pickedAction = actions.find((action) => action.id === picked) ?? null;
	if (pickedAction) {
		return (
			<div className="py-3">
				<Readiness
					action={pickedAction}
					busy={busy}
					itemKey={itemKey}
					onClose={() => setPicked(null)}
					onConfirm={() => onActivate(pickedAction.id)}
					onGoToField={onGoToField}
				/>
			</div>
		);
	}
	return (
		<div className="flex flex-wrap items-center gap-1.5 py-3">
			{actions.map((action) => (
				<Button
					key={action.id}
					isDisabled={busy}
					onPress={() => setPicked(action.id)}
					size="xs"
					startContent={
						action.id === "register-crossref" ? (
							<BadgeCheck aria-hidden size={13} />
						) : (
							<Archive aria-hidden size={13} />
						)
					}
					variant="flat"
				>
					{action.label}
				</Button>
			))}
		</div>
	);
}

function IdentifiersBody({
	bodyId,
	busy,
	identifiers,
	itemKey,
	onActivate,
	onGoToField,
	onOpenAttachments,
	onRetry,
	picked,
	providers,
	setPicked,
}: {
	bodyId: string;
	busy: boolean;
	identifiers: AdminIdentifiersView;
	itemKey: string;
	onActivate: (action: AdminIdentifiersActionId) => void;
	onGoToField: (field: string) => void;
	onOpenAttachments: () => void;
	onRetry: (provider: "crossref" | "zenodo") => void;
	picked: AdminIdentifiersActionId | null;
	providers: { crossref: AdminPublicationProviderView; zenodo: AdminPublicationProviderView };
	setPicked: (action: AdminIdentifiersActionId | null) => void;
}) {
	return (
		<div
			className="divide-y divide-black/[0.06] border-t border-black/[0.06] px-3.5 dark:divide-white/[0.07] dark:border-white/[0.07]"
			id={bodyId}
		>
			{identifiers.doi ? (
				<IdentifierDoi doi={identifiers.doi} />
			) : (
				<p className="py-3 text-xs leading-5 text-black/55 dark:text-white/55">No DOI yet.</p>
			)}
			{identifiers.registration.state === "active" ? (
				<ActivityRow
					activity={identifiers.registration}
					busy={busy}
					onOpenAttachments={onOpenAttachments}
					onRetry={() => onRetry("crossref")}
					provider={providers.crossref}
					title="Crossref registration"
				/>
			) : null}
			{identifiers.archive.state === "active" ? (
				<ActivityRow
					activity={identifiers.archive}
					busy={busy}
					onOpenAttachments={onOpenAttachments}
					onRetry={() => onRetry("zenodo")}
					provider={providers.zenodo}
					title="Zenodo archive"
				/>
			) : null}
			<IdentifierActions
				actions={identifiers.actions}
				busy={busy}
				itemKey={itemKey}
				onActivate={onActivate}
				onGoToField={onGoToField}
				picked={picked}
				setPicked={setPicked}
			/>
		</div>
	);
}

export function AdminIdentifiersCard({
	busy,
	identifiers,
	itemKey,
	onActivate,
	onGoToField,
	onOpenAttachments,
	onRetry,
	providers,
}: {
	busy: boolean;
	identifiers: AdminIdentifiersView;
	itemKey: string;
	onActivate: (action: AdminIdentifiersActionId) => void;
	onGoToField: (field: string) => void;
	onOpenAttachments: () => void;
	onRetry: (provider: "crossref" | "zenodo") => void;
	providers: { crossref: AdminPublicationProviderView; zenodo: AdminPublicationProviderView };
}) {
	const [userOpen, setUserOpen] = useState<boolean | null>(null);
	const [picked, setPicked] = useState<AdminIdentifiersActionId | null>(null);
	const open = identifiers.attention || (userOpen ?? false);
	const bodyId = `admin-${itemKey}-identifiers`;
	const toggleId = `admin-${itemKey}-identifiers-toggle`;

	return (
		<div className="overflow-hidden rounded-xl bg-black/[0.025] dark:bg-white/[0.035]">
			<IdentifiersHeader
				bodyId={bodyId}
				identifiers={identifiers}
				onToggle={() => setUserOpen(!open)}
				open={open}
				toggleId={toggleId}
			/>
			{open ? (
				<IdentifiersBody
					bodyId={bodyId}
					busy={busy}
					identifiers={identifiers}
					itemKey={itemKey}
					onActivate={onActivate}
					onGoToField={onGoToField}
					onOpenAttachments={onOpenAttachments}
					onRetry={onRetry}
					picked={picked}
					providers={providers}
					setPicked={setPicked}
				/>
			) : null}
		</div>
	);
}
