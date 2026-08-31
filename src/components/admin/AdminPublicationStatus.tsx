"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { AlertCircleIcon, CheckmarkBadge01Icon, CircleIcon, FileAttachmentIcon, Loading03Icon } from "@hugeicons/core-free-icons";
import type { ZenodoIdentifierPolicy } from "@/db/schema/publication";
import { useState } from "react";

import { Button } from "@/components/nextui/Button";
import { AdminIdentifiersCard } from "./AdminIdentifiersCard";
import { validationTargetId } from "./admin-validation";
import type { useAdminPublication } from "./useAdminPublication";
import {
	AdminCrossrefActivation,
	AdminZenodoActivation,
} from "./AdminPublicationActivation";

type PublicationHook = ReturnType<typeof useAdminPublication>;
type Publication = NonNullable<PublicationHook["publication"]>;

function headerPresentation(
	publication: Publication,
	changing: boolean,
) {
	if (publication.identifiers.attention) {
		return { Icon: AlertCircleIcon, label: "DOI needs attention", color: "text-danger", spin: false };
	}
	if (changing) {
		return { Icon: Loading03Icon, label: "DOI publishing", color: "text-accent", spin: true };
	}
	if (publication.identifiers.doi) {
		return {
			Icon: CheckmarkBadge01Icon,
			label: "DOI",
			color: "text-emerald-600 dark:text-emerald-300",
			spin: false,
		};
	}
	return {
		Icon: CircleIcon,
		label: "No DOI",
		color: "text-black/40 dark:text-white/40",
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
	const { providers } = publication;
	const changing = [providers.crossref, providers.zenodo].some(
		(provider) => provider.status.shouldPoll,
	);
	const { Icon, color, label, spin } = headerPresentation(publication, changing);
	return (
		<button
			className={`inline-flex h-6 items-center gap-1 whitespace-nowrap text-[11px] font-medium transition-opacity hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${color}`}
			onClick={onPress}
			type="button"
		>
			<span className="grid size-3 shrink-0 place-items-center overflow-hidden">
				<HugeiconsIcon icon={Icon} aria-hidden className={spin ? "animate-spin" : undefined} size={12} />
			</span>
			{label}
		</button>
	);
}

function UnpublishedPublicationNotice() {
	return (
		<div
			className="flex items-center gap-3 rounded-xl bg-black/[0.025] p-3.5 text-xs text-black/45 dark:bg-white/[0.035] dark:text-white/45"
			role="status"
		>
			<HugeiconsIcon icon={FileAttachmentIcon} aria-hidden className="shrink-0" size={16} />
			<span>Publish this record before activating a DOI.</span>
		</div>
	);
}

function PublicationLoading({ state }: { state: PublicationHook }) {
	return (
		<div
			className="flex min-h-24 items-center justify-center rounded-xl bg-black/[0.025] text-xs text-black/45 dark:bg-white/[0.035] dark:text-white/45"
			role="status"
		>
			{state.error ? (
				<div className="flex items-center gap-2 px-3 text-danger">
					<HugeiconsIcon icon={AlertCircleIcon} aria-hidden size={14} />
					<span>{state.error}</span>
					<Button onPress={() => void state.refresh()} size="xs" variant="transparent">
						Try again
					</Button>
				</div>
			) : (
				<div className="flex items-center gap-2">
					<span className="grid size-4 place-items-center overflow-hidden">
						<HugeiconsIcon icon={Loading03Icon} aria-hidden className="animate-spin" size={16} />
					</span>
					Loading DOI publishing
				</div>
			)}
		</div>
	);
}

function PublicationActionError({
	itemKey,
	onGoToField,
	state,
}: {
	itemKey: string;
	onGoToField: (field: string) => void;
	state: PublicationHook;
}) {
	if (!state.actionError) return null;
	return (
		<div className="bg-danger/[0.06] p-3 text-xs text-danger" role="alert">
			<p className="font-medium">{state.actionError}</p>
			{Object.entries(state.actionFieldErrors).length > 0 ? (
				<ul className="mt-1.5 space-y-1">
					{Object.entries(state.actionFieldErrors).map(([path, message]) => {
						const target = validationTargetId(itemKey, path);
						return (
							<li key={path}>
								{target ? (
									<button
										className="text-left underline underline-offset-2"
										onClick={() => onGoToField(path)}
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

function defaultZenodoPolicy(
	allowedPolicies: readonly ZenodoIdentifierPolicy[],
): ZenodoIdentifierPolicy {
	if (allowedPolicies.includes("reuse-external")) return "reuse-external";
	if (allowedPolicies.includes("reuse-crossref")) return "reuse-crossref";
	return "mint-zenodo";
}

function policyForAction(
	action: "archive-zenodo" | "mint-zenodo",
	allowedPolicies: readonly ZenodoIdentifierPolicy[],
): ZenodoIdentifierPolicy {
	if (action === "mint-zenodo") return "mint-zenodo";
	return allowedPolicies.includes("reuse-external")
		? "reuse-external"
		: "reuse-crossref";
}

function selectedZenodoPolicy(input: {
	choice: { itemKey: string; policy: ZenodoIdentifierPolicy } | null;
	itemKey: string;
	allowedPolicies: readonly ZenodoIdentifierPolicy[];
}) {
	if (
		input.choice?.itemKey === input.itemKey &&
		input.allowedPolicies.includes(input.choice.policy)
	) {
		return input.choice.policy;
	}
	return defaultZenodoPolicy(input.allowedPolicies);
}

async function completePublicationAction(
	action: () => Promise<boolean>,
	onRecordChanged: () => void,
) {
	const succeeded = await action();
	if (succeeded) onRecordChanged();
	return succeeded;
}

function PublicationActivationDialogs({
	complete,
	crossrefOpen,
	publication,
	setCrossrefOpen,
	setPolicyChoice,
	setZenodoOpen,
	state,
	zenodoOpen,
	zenodoPolicy,
}: {
	complete: (action: () => Promise<boolean>) => Promise<boolean>;
	crossrefOpen: boolean;
	publication: Publication;
	setCrossrefOpen: (open: boolean) => void;
	setPolicyChoice: (choice: { itemKey: string; policy: ZenodoIdentifierPolicy }) => void;
	setZenodoOpen: (open: boolean) => void;
	state: PublicationHook;
	zenodoOpen: boolean;
	zenodoPolicy: ZenodoIdentifierPolicy;
}) {
	return (
		<>
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
				onPolicyChange={(policy) =>
					setPolicyChoice({ itemKey: publication.itemKey, policy })
				}
				policy={zenodoPolicy}
				publication={publication}
			/>
		</>
	);
}

function PublicationControls({
	itemKey,
	onGoToField,
	onOpenAttachments,
	onRecordChanged,
	publication,
	state,
}: {
	itemKey: string;
	onGoToField: (field: string) => void;
	onOpenAttachments: () => void;
	onRecordChanged: () => void;
	publication: Publication;
	state: PublicationHook;
}) {
	const [crossrefOpen, setCrossrefOpen] = useState(false);
	const [zenodoOpen, setZenodoOpen] = useState(false);
	const [policyChoice, setPolicyChoice] = useState<{
		itemKey: string;
		policy: ZenodoIdentifierPolicy;
	} | null>(null);
	const allowedPolicies = publication.providers.zenodo.capabilities.allowedIdentifierPolicies;
	const zenodoPolicy = selectedZenodoPolicy({
		choice: policyChoice,
		itemKey,
		allowedPolicies,
	});
	const complete = (action: () => Promise<boolean>) =>
		completePublicationAction(action, onRecordChanged);
	const activate = (action: "register-crossref" | "archive-zenodo" | "mint-zenodo") => {
		state.clearActionError();
		if (action === "register-crossref") {
			setCrossrefOpen(true);
			return;
		}
		setPolicyChoice({ itemKey, policy: policyForAction(action, allowedPolicies) });
		setZenodoOpen(true);
	};

	return (
		<>
			<div className="space-y-2">
				{!crossrefOpen && !zenodoOpen ? (
					<PublicationActionError
						itemKey={itemKey}
						onGoToField={onGoToField}
						state={state}
					/>
				) : null}
				<AdminIdentifiersCard
					busy={state.isMutating}
					identifiers={publication.identifiers}
					itemKey={itemKey}
					key={itemKey}
					onActivate={activate}
					onGoToField={onGoToField}
					onOpenAttachments={onOpenAttachments}
					onRetry={(provider) =>
						void complete(
							provider === "crossref" ? state.retryCrossref : state.retryZenodo,
						)
					}
					providers={publication.providers}
				/>
			</div>
			<PublicationActivationDialogs
				complete={complete}
				crossrefOpen={crossrefOpen}
				publication={publication}
				setCrossrefOpen={setCrossrefOpen}
				setPolicyChoice={setPolicyChoice}
				setZenodoOpen={setZenodoOpen}
				state={state}
				zenodoOpen={zenodoOpen}
				zenodoPolicy={zenodoPolicy}
			/>
		</>
	);
}

export function AdminPublicationStatus({
	itemKey,
	onGoToField,
	onOpenAttachments,
	onRecordChanged,
	published,
	state,
}: {
	itemKey: string;
	onGoToField: (field: string) => void;
	onOpenAttachments: () => void;
	onRecordChanged: () => void;
	published: boolean;
	state: PublicationHook;
}) {
	if (!published) {
		return <UnpublishedPublicationNotice />;
	}
	const publication = state.publication;
	if (!publication) {
		return <PublicationLoading state={state} />;
	}
	return (
		<PublicationControls
			itemKey={itemKey}
			onGoToField={onGoToField}
			onOpenAttachments={onOpenAttachments}
			onRecordChanged={onRecordChanged}
			publication={publication}
			state={state}
		/>
	);
}
