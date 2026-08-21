"use client";

import type { ZenodoIdentifierPolicy } from "@/db/schema/publication";
import {
	AlertCircle,
	BadgeCheck,
	Circle,
	FileText,
	LoaderCircle,
} from "lucide-react";
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

export function AdminPublicationHeaderStatus({
	onPress,
	state,
}: {
	onPress: () => void;
	state: PublicationHook;
}) {
	const publication = state.publication;
	if (!publication) return null;
	const { identifiers, providers } = publication;
	const changing = [providers.crossref, providers.zenodo].some(
		(provider) => provider.status.shouldPoll,
	);
	const label = identifiers.attention
		? "DOI needs attention"
		: changing
			? "DOI publishing"
			: identifiers.doi
				? "DOI"
				: "No DOI";
	const Icon = identifiers.attention
		? AlertCircle
		: changing
			? LoaderCircle
			: identifiers.doi
				? BadgeCheck
				: Circle;
	return (
		<button
			className={`inline-flex h-6 items-center gap-1 whitespace-nowrap text-[11px] font-medium transition-opacity hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
				identifiers.attention
					? "text-danger"
					: changing
						? "text-accent"
						: identifiers.doi
							? "text-emerald-600 dark:text-emerald-300"
							: "text-black/40 dark:text-white/40"
			}`}
			onClick={onPress}
			type="button"
		>
			<span className="grid size-3 shrink-0 place-items-center overflow-hidden">
				<Icon aria-hidden className={changing && !identifiers.attention ? "animate-spin" : undefined} size={12} />
			</span>
			{label}
		</button>
	);
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
		policy: ZenodoIdentifierPolicy;
	} | null>(null);
	if (!published) {
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
	const publication = state.publication;
	if (!publication) {
		return (
			<div className="flex min-h-24 items-center justify-center rounded-xl bg-black/[0.025] text-xs text-black/45 dark:bg-white/[0.035] dark:text-white/45" role="status">
				{state.error ? (
					<div className="flex items-center gap-2 px-3 text-danger">
						<AlertCircle aria-hidden size={14} />
						<span>{state.error}</span>
						<Button onPress={() => void state.refresh()} size="xs" variant="transparent">Try again</Button>
					</div>
				) : (
					<div className="flex items-center gap-2">
						<span className="grid size-4 place-items-center overflow-hidden"><LoaderCircle aria-hidden className="animate-spin" size={16} /></span>
						Loading DOI publishing
					</div>
				)}
			</div>
		);
	}
	const allowedPolicies = publication.providers.zenodo.capabilities.allowedIdentifierPolicies;
	const defaultPolicy = allowedPolicies.includes("reuse-external")
		? "reuse-external"
		: allowedPolicies.includes("reuse-crossref")
			? "reuse-crossref"
			: "mint-zenodo";
	const zenodoPolicy =
		policyChoice?.itemKey === itemKey && allowedPolicies.includes(policyChoice.policy)
			? policyChoice.policy
			: defaultPolicy;
	const complete = async (action: () => Promise<boolean>) => {
		const succeeded = await action();
		if (succeeded) onRecordChanged();
		return succeeded;
	};

	return (
		<>
			<div className="space-y-2">
				{state.actionError && !crossrefOpen && !zenodoOpen ? (
					<div className="bg-danger/[0.06] p-3 text-xs text-danger" role="alert">
						<p className="font-medium">{state.actionError}</p>
						{Object.entries(state.actionFieldErrors).length > 0 ? (
							<ul className="mt-1.5 space-y-1">
								{Object.entries(state.actionFieldErrors).map(([path, message]) => {
									const target = validationTargetId(itemKey, path);
									return (
										<li key={path}>
											{target ? (
												<button className="text-left underline underline-offset-2" onClick={() => document.getElementById(target)?.focus()} type="button">{message}</button>
											) : message}
										</li>
									);
								})}
							</ul>
						) : null}
					</div>
				) : null}
				<AdminIdentifiersCard
					busy={state.isMutating}
					identifiers={publication.identifiers}
					itemKey={itemKey}
					onActivate={(action) => {
						state.clearActionError();
						if (action === "register-crossref") {
							setCrossrefOpen(true);
							return;
						}
						setPolicyChoice({
							itemKey,
							policy:
								action === "archive-zenodo"
									? allowedPolicies.includes("reuse-external")
										? "reuse-external"
										: "reuse-crossref"
									: "mint-zenodo",
						});
						setZenodoOpen(true);
					}}
					onOpenAttachments={onOpenAttachments}
					onRetry={(provider) =>
						void complete(provider === "crossref" ? state.retryCrossref : state.retryZenodo)
					}
					providers={publication.providers}
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
