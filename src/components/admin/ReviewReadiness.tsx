"use client";

import { useMemo, useState } from "react";
import { Accordion, AccordionItem } from "@nextui-org/react";
import { useReducedMotion } from "framer-motion";
import {
	AlertCircleIcon,
	ArrowRight01Icon,
	CheckmarkBadge01Icon,
	Comment01Icon,
	FilePenLineIcon,
	FingerPrintIcon,
	Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import type { PublishingChoice } from "@/lib/admin/review-contract";
import type { AdminItemDetail } from "@/lib/admin/types";
import { adminFieldLabel } from "@/lib/admin/errors";
import { publishingNeeds } from "@/lib/admin/review-validation";
import { validationTargetId } from "./admin-validation";
import { useReturnWords } from "./review-words";
import type { usePublishingChoice } from "./usePublishingChoice";

export function useReviewReadiness(
	detail: AdminItemDetail,
	payload: Record<string, unknown>,
	publishing: ReturnType<typeof usePublishingChoice>,
	submittedChoice?: PublishingChoice | null,
) {
	const { saved } = publishing;
	const submitted = submittedChoice !== undefined;
	const choice = submitted ? submittedChoice : (saved.data?.choice ?? null);
	const loading = !submitted && saved.isLoading;
	const error = !submitted && saved.error;
	const loaded = submitted || saved.data !== undefined;
	// The publishing choice belongs to the record a review is for; an attachment is checked without one, as the
	// server checks it.
	const created = detail.kind === "created" && !detail.parentItem;
	const fields = useMemo(
		() => publishingNeeds(payload, created ? choice : null),
		[payload, choice, created],
	);
	const checks = reviewChecks(payload, fields, created, {
		loading,
		error,
		loaded,
		choice,
	});
	return {
		checks,
		missing: checks.filter((check) => !check.ready).length,
		saving: !submitted && publishing.saving,
		loading: created && loading,
	};
}

export function ReviewReadiness({
	recordKey,
	readiness,
	requestedChanges,
}: {
	recordKey: string;
	readiness: ReturnType<typeof useReviewReadiness>;
	requestedChanges?: string | null;
}) {
	const { checks, missing, loading } = readiness;
	const words = useReturnWords();
	const header = readinessHeader(missing > 0 || loading, requestedChanges, words.state);
	const [disclosure, setDisclosure] = useState({
		open: header.open,
		expanded: header.open,
	});
	if (disclosure.open !== header.open)
		setDisclosure({ open: header.open, expanded: header.open });
	const reducedMotion = useReducedMotion();
	return (
		<section
			aria-label="Review requirements"
			className="overflow-hidden rounded-xl bg-black/[0.025] ring-1 ring-inset ring-black/[0.05] dark:bg-white/[0.035] dark:ring-white/[0.06]"
		>
			<Accordion
				selectedKeys={
					disclosure.expanded ? new Set(["requirements"]) : new Set()
				}
				onSelectionChange={(keys) =>
					setDisclosure({
						open: header.open,
						expanded: keys === "all" || keys.has("requirements"),
					})
				}
				showDivider={false}
				disableAnimation={Boolean(reducedMotion)}
				className="px-0"
				itemClasses={{
					base: "px-0",
					trigger: "gap-2 px-3 py-3",
					titleWrapper: "min-w-0",
					title: "text-xs",
					indicator: "text-black/40 dark:text-white/40",
					content: "pb-1.5 pt-0",
				}}
			>
				<AccordionItem
					key="requirements"
					aria-label={header.label}
					title={
						<span className="flex items-center gap-2 text-xs font-semibold">
							<HugeiconsIcon
								icon={header.icon}
								size={15}
								className={header.className}
							/>
							<span className="flex-1">{header.label}</span>
							{missing > 0 && !loading && (
								<span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
									{missing} missing
								</span>
							)}
						</span>
					}
				>
					<div className="p-1.5">
						<RequestedChangesNote text={requestedChanges} />
						{checks.map((check) => (
							<button
								key={check.key}
								type="button"
								className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-black/[0.035] focus-visible:outline-focus dark:hover:bg-white/[0.045]"
								onClick={() => {
									const target = document.getElementById(
										check.key === "identifiers"
											? "admin-doi-publishing"
											: (validationTargetId(
													recordKey,
													check.key,
												) ?? "admin-metadata"),
									);
									target?.scrollIntoView({
										behavior: matchMedia(
											"(prefers-reduced-motion: reduce)",
										).matches
											? "instant"
											: "smooth",
										block: "center",
									});
									(target?.matches("input,textarea,button")
										? target
										: target?.querySelector<HTMLElement>(
												"input,textarea,button",
											)
									)?.focus({ preventScroll: true });
								}}
							>
								<span
									className={`grid size-8 shrink-0 place-items-center self-start rounded-lg ${check.ready ? "bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-400" : "bg-amber-500/[0.09] text-amber-700 dark:text-amber-300"}`}
								>
									<HugeiconsIcon
										icon={
											check.ready
												? Tick01Icon
												: check.icon
										}
										size={15}
									/>
								</span>
								<span className="min-w-0 flex-1">
									<span className="block text-xs font-medium">
										{check.label}
									</span>
									<span className="mt-0.5 block text-[11px] leading-relaxed text-black/50 dark:text-white/55">
										{check.detail}
									</span>
								</span>
								<HugeiconsIcon
									icon={ArrowRight01Icon}
									size={14}
									className="shrink-0 text-black/30 dark:text-white/35"
								/>
							</button>
						))}
					</div>
				</AccordionItem>
			</Accordion>
		</section>
	);
}

function readinessHeader(blocked: boolean, requestedChanges: string | null | undefined, returned: string) {
	if (requestedChanges)
		return {
			label: returned,
			icon: Comment01Icon,
			className: "text-rose-700 dark:text-rose-300",
			open: true,
		};
	if (blocked)
		return {
			label: "Review requirements",
			icon: CheckmarkBadge01Icon,
			className: "text-black/45 dark:text-white/50",
			open: true,
		};
	return {
		label: "Ready for review",
		icon: Tick01Icon,
		className: "text-emerald-700 dark:text-emerald-400",
		open: false,
	};
}

function RequestedChangesNote({ text }: { text?: string | null }) {
	return text ? (
		<p className="whitespace-pre-wrap px-2 py-2 text-[11px] leading-relaxed text-black/65 dark:text-white/65">
			{text}
		</p>
	) : null;
}

function identifierLabel(
	loading: boolean,
	error: unknown,
	choice: PublishingChoice | null,
) {
	if (loading) return "";
	if (error) return "Could not load identifiers";
	if (!choice) return "None";
	return choice.route === "zenodo" ? "Zenodo" : "Crossref + Zenodo";
}

function reviewChecks(
	payload: Record<string, unknown>,
	fields: Record<string, string>,
	created: boolean,
	{
		loading,
		error,
		loaded,
		choice,
	}: {
		loading: boolean;
		error: unknown;
		loaded: boolean;
		choice: PublishingChoice | null;
	},
) {
	const hasTitle =
		typeof payload.title === "string" && Boolean(payload.title.trim());
	const title = hasTitle && !fields.title;
	const checks = [
		{
			key: "title",
			label: "Title",
			detail: hasTitle ? (fields.title ?? "Added") : "Add a title",
			ready: title,
			icon: FilePenLineIcon,
		},
		...(created
			? [
					{
						key: "identifiers",
						label: "Identifiers",
						detail: identifierLabel(loading, error, choice),
						ready: !loading && !error && loaded,
						icon: FingerPrintIcon,
					},
				]
			: []),
		...Object.entries(fields)
			.filter(([key]) => key !== "title")
			.map(([key, message]) => ({
				key,
				label: adminFieldLabel(key),
				detail: message,
				ready: false,
				icon: AlertCircleIcon,
			})),
	];
	return checks;
}
