"use client";

import { Tooltip } from "@/components/nextui/Tooltip";
import {
	AlertCircle,
	BadgeCheck,
	Circle,
	CircleCheck,
	Clock3,
	Copy,
	ExternalLink,
	FileText,
	LoaderCircle,
	RefreshCw,
	Wrench,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/nextui/Button";
import type { AdminPublicationProviderView } from "@/lib/publication/admin-publication-view";
import { validationTargetId } from "./admin-validation";
import type { useAdminPublication } from "./useAdminPublication";
import {
	AdminCrossrefActivation,
	AdminZenodoActivation,
} from "./AdminPublicationActivation";

const appearance = {
	blocked: { icon: AlertCircle, className: "text-danger", spin: false },
	external: {
		icon: CircleCheck,
		className: "text-black/50 dark:text-white/50",
		spin: false,
	},
	failed: { icon: AlertCircle, className: "text-danger", spin: false },
	inactive: {
		icon: Circle,
		className: "text-black/35 dark:text-white/35",
		spin: false,
	},
	queued: { icon: Clock3, className: "text-accent", spin: false },
	repair_pending: { icon: Wrench, className: "text-amber-600 dark:text-amber-300", spin: false },
	retrying: { icon: RefreshCw, className: "text-accent", spin: true },
	synced: { icon: CircleCheck, className: "text-emerald-600 dark:text-emerald-300", spin: false },
	verifying: { icon: LoaderCircle, className: "text-accent", spin: true },
	waiting: { icon: Clock3, className: "text-amber-600 dark:text-amber-300", spin: false },
	working: { icon: LoaderCircle, className: "text-accent", spin: true },
} as const;

type PublicationHook = ReturnType<typeof useAdminPublication>;
type ZenodoPolicy = "mint-zenodo" | "reuse-crossref";

function focusSection(id: string) {
	document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function ProviderLinks({ provider }: { provider: AdminPublicationProviderView }) {
	if (provider.links.length === 0) return null;
	return (
		<div className="mt-2 space-y-1.5">
			{provider.links.map((link) => {
				const copyValue = link.kind === "doi" ? link.value : link.url;
				return (
				<div key={`${link.kind}:${link.value}`} className="flex min-w-0 items-center gap-1.5">
					<a
						className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-black/65 underline decoration-black/15 underline-offset-2 hover:decoration-black/40 dark:text-white/70 dark:decoration-white/20 dark:hover:decoration-white/50"
						href={link.url}
						rel="noreferrer"
						target="_blank"
					>
						{link.kind === "doi" ? link.value : link.label}
					</a>
					<Tooltip content={`Copy ${link.label}`}>
						<Button
							aria-label={`Copy ${link.label}`}
							isIconOnly
							onPress={() => {
								void navigator.clipboard
									.writeText(copyValue)
									.then(() => toast.success(`${link.label} copied`))
									.catch(() => toast.error(`Could not copy ${link.label.toLowerCase()}`));
							}}
							size="xs"
							variant="transparent"
						>
							<Copy aria-hidden size={13} />
						</Button>
					</Tooltip>
					<Tooltip content={`Open ${link.label}`}>
						<Button
							as="a"
							aria-label={`Open ${link.label}`}
							href={link.url}
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
			})}
		</div>
	);
}

/** The issues holding a provider up, beyond the first one shown above. */
function ProviderBlockers({ blockers }: { blockers: readonly string[] }) {
	if (blockers.length < 2) return null;

	return (
		<details className="mt-2 text-xs text-danger">
			<summary className="cursor-pointer font-medium">Show all issues</summary>
			<ul className="mt-1.5 space-y-1 pl-4">
				{blockers.slice(1).map((blocker) => <li key={blocker}>{blocker}</li>)}
			</ul>
		</details>
	);
}

/** What the editor can do about this provider right now. */
function ProviderActions({
	busy,
	onActivate,
	onOpenAttachments,
	onRetry,
	provider,
}: {
	busy: boolean;
	onActivate: () => void;
	onOpenAttachments: () => void;
	onRetry: () => void;
	provider: AdminPublicationProviderView;
}) {
	return (
		<div className="mt-2.5 flex flex-wrap items-center gap-1.5">
			{provider.capabilities.canActivate ? (
				<Button color="accent" isDisabled={busy} onPress={onActivate} size="xs" variant="solid">
					{provider.capabilities.actionLabel}
				</Button>
			) : null}
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
			{provider.waitingOn === "crossref" ? (
				<Button onPress={() => focusSection("admin-doi-publishing")} size="xs" variant="transparent">
					Open Crossref status
				</Button>
			) : null}
			{provider.exact.identifierPolicy ? (
				<span className="text-[11px] text-black/40 dark:text-white/40">
					{provider.exact.identifierPolicy === "reuse-crossref" ? "Uses the Crossref DOI" : "Uses Zenodo DOIs"}
				</span>
			) : null}
		</div>
	);
}

function ProviderRow({
	busy,
	onActivate,
	onOpenAttachments,
	onRetry,
	provider,
}: {
	busy: boolean;
	onActivate: () => void;
	onOpenAttachments: () => void;
	onRetry: () => void;
	provider: AdminPublicationProviderView;
}) {
	const state = appearance[provider.displayState];
	const Icon = state.icon;
	const providerName = provider.provider === "crossref" ? "Crossref" : "Zenodo";
	const purpose =
		provider.provider === "crossref"
			? "Register the record DOI"
			: "Archive the record and PDF";
	return (
		<div className="p-3.5" data-admin-publication-provider={provider.provider}>
			<div className="flex items-start gap-3">
				<span className={`mt-0.5 grid size-4 shrink-0 place-items-center overflow-hidden ${state.className}`}>
					<Icon aria-hidden className={state.spin ? "animate-spin" : undefined} size={16} strokeWidth={2} />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
						<div>
							<p className="text-sm font-semibold text-black/85 dark:text-white/90">{providerName}</p>
							<p className="text-[11px] text-black/40 dark:text-white/40">{purpose}</p>
						</div>
						<span className={`text-xs font-semibold ${state.className}`} aria-live="polite">
							{provider.status.label}
						</span>
					</div>
					<p className="mt-2 text-xs leading-5 text-black/55 dark:text-white/55">{provider.status.description}</p>
					<ProviderLinks provider={provider} />
					<ProviderBlockers blockers={provider.blockers} />
					<ProviderActions
						busy={busy}
						onActivate={onActivate}
						onOpenAttachments={onOpenAttachments}
						onRetry={onRetry}
						provider={provider}
					/>
				</div>
			</div>
		</div>
	);
}

function publicationHeaderAppearance(
	providers: AdminPublicationProviderView[],
) {
	const active = providers.filter((provider) => provider.exact.targetActive);
	const needsAttention = providers.some((provider) =>
		["blocked", "failed"].includes(provider.displayState),
	);
	if (active.length === 0 && !needsAttention) return null;
	const changing = providers.some((provider) => provider.status.shouldPoll);
	if (needsAttention) {
		return {
			className: "text-danger",
			Icon: AlertCircle,
			label: "DOI needs attention",
			spin: false,
		};
	}
	if (changing) {
		return {
			className: "text-accent",
			Icon: LoaderCircle,
			label: "DOI publishing",
			spin: true,
		};
	}
	return {
		className: "text-emerald-600 dark:text-emerald-300",
		Icon: BadgeCheck,
		label: active.every((provider) => provider.displayState === "synced")
			? "DOI synced"
			: "DOI active",
		spin: false,
	};
}

export function AdminPublicationHeaderStatus({
	onPress,
	state,
}: {
	onPress: () => void;
	state: PublicationHook;
}) {
	const publication = state.publication;
	if (!publication) return null;
	const status = publicationHeaderAppearance(
		Object.values(publication.providers),
	);
	if (!status) return null;
	const { className, Icon, label, spin } = status;
	return (
		<button
			className={`inline-flex h-6 items-center gap-1 whitespace-nowrap text-[11px] font-medium transition-opacity hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${className}`}
			onClick={onPress}
			type="button"
		>
			<span className="grid size-3 shrink-0 place-items-center overflow-hidden">
				<Icon aria-hidden className={spin ? "animate-spin" : undefined} size={12} />
			</span>
			{label}
		</button>
	);
}

function UnpublishedStatus() {
	return (
		<div
			className="flex items-center gap-3 rounded-xl bg-black/[0.025] p-3.5 text-xs text-black/45 dark:bg-white/[0.035] dark:text-white/45"
			role="status"
		>
			<FileText aria-hidden className="shrink-0" size={16} />
			<span>Publish this record before activating a DOI.</span>
		</div>
	);
}

function LoadingPublicationStatus({ state }: { state: PublicationHook }) {
	return (
		<div
			className="flex min-h-24 items-center justify-center rounded-xl bg-black/[0.025] text-xs text-black/45 dark:bg-white/[0.035] dark:text-white/45"
			role="status"
		>
			{state.error ? (
				<div className="flex items-center gap-2 px-3 text-danger">
					<AlertCircle aria-hidden size={14} />
					<span>{state.error}</span>
					<Button
						onPress={() => void state.refresh()}
						size="xs"
						variant="transparent"
					>
						Try again
					</Button>
				</div>
			) : (
				<div className="flex items-center gap-2">
					<span className="grid size-4 place-items-center overflow-hidden">
						<LoaderCircle aria-hidden className="animate-spin" size={16} />
					</span>
					Loading DOI publishing
				</div>
			)}
		</div>
	);
}

function PublicationActionError({
	actionError,
	fieldErrors,
	itemKey,
}: {
	actionError: string | null;
	fieldErrors: Record<string, string>;
	itemKey: string;
}) {
	if (!actionError) return null;
	const entries = Object.entries(fieldErrors);
	return (
		<div className="bg-danger/[0.06] p-3 text-xs text-danger" role="alert">
			<p className="font-medium">{actionError}</p>
			{entries.length > 0 ? (
				<ul className="mt-1.5 space-y-1">
					{entries.map(([path, message]) => {
						const target = validationTargetId(itemKey, path);
						return (
							<li key={path}>
								{target ? (
									<button
										className="text-left underline underline-offset-2"
										onClick={() => document.getElementById(target)?.focus()}
										type="button"
									>
										{message}
									</button>
								) : (
									message
								)}
							</li>
						);
					})}
				</ul>
			) : null}
		</div>
	);
}

function selectedZenodoPolicy(
	itemKey: string,
	choice: { itemKey: string; policy: ZenodoPolicy } | null,
	allowedPolicies: readonly ZenodoPolicy[],
): ZenodoPolicy {
	if (choice?.itemKey === itemKey && allowedPolicies.includes(choice.policy)) {
		return choice.policy;
	}
	return allowedPolicies.includes("reuse-crossref")
		? "reuse-crossref"
		: "mint-zenodo";
}

export function AdminPublicationStatus({
	itemKey,
	onOpenAttachments,
	onRecordChanged,
	published,
	state,
}: {
	itemKey: string;
	onOpenAttachments: () => void;
	onRecordChanged: () => void;
	published: boolean;
	state: PublicationHook;
}) {
	const [crossrefOpen, setCrossrefOpen] = useState(false);
	const [zenodoOpen, setZenodoOpen] = useState(false);
	const [policyChoice, setPolicyChoice] = useState<{
		itemKey: string;
		policy: ZenodoPolicy;
	} | null>(null);
	if (!published) return <UnpublishedStatus />;
	const publication = state.publication;
	if (!publication) return <LoadingPublicationStatus state={state} />;
	const allowedPolicies = publication.providers.zenodo.capabilities.allowedIdentifierPolicies;
	const zenodoPolicy = selectedZenodoPolicy(
		itemKey,
		policyChoice,
		allowedPolicies,
	);
	const complete = async (action: () => Promise<boolean>) => {
		const succeeded = await action();
		if (succeeded) onRecordChanged();
		return succeeded;
	};

	return (
		<>
			<div className="divide-y divide-black/[0.06] overflow-hidden rounded-xl bg-black/[0.025] dark:divide-white/[0.07] dark:bg-white/[0.035]">
					<PublicationActionError
						actionError={
							crossrefOpen || zenodoOpen ? null : state.actionError
						}
						fieldErrors={state.actionFieldErrors}
						itemKey={itemKey}
					/>
				<ProviderRow
					busy={state.isMutating}
					onActivate={() => {
						state.clearActionError();
						setCrossrefOpen(true);
					}}
					onOpenAttachments={onOpenAttachments}
					onRetry={() => void complete(state.retryCrossref)}
					provider={publication.providers.crossref}
				/>
				<ProviderRow
					busy={state.isMutating}
					onActivate={() => {
						state.clearActionError();
						setZenodoOpen(true);
					}}
					onOpenAttachments={onOpenAttachments}
					onRetry={() => void complete(state.retryZenodo)}
					provider={publication.providers.zenodo}
				/>
			</div>
			<AdminCrossrefActivation
				busy={state.isMutating && state.action === "activate-crossref"}
				error={state.action === "activate-crossref" ? state.actionError : null}
				fieldErrors={state.actionFieldErrors}
				isOpen={crossrefOpen}
				onConfirm={() => complete(state.activateCrossref)}
				onOpenChange={setCrossrefOpen}
				publication={publication}
			/>
			<AdminZenodoActivation
				busy={state.isMutating && state.action === "activate-zenodo"}
				error={state.action === "activate-zenodo" ? state.actionError : null}
				fieldErrors={state.actionFieldErrors}
				isOpen={zenodoOpen}
				onConfirm={() => complete(() => state.activateZenodo(zenodoPolicy))}
				onOpenChange={setZenodoOpen}
				onPolicyChange={(policy) => setPolicyChoice({ itemKey, policy })}
				policy={zenodoPolicy}
				publication={publication}
			/>
		</>
	);
}
