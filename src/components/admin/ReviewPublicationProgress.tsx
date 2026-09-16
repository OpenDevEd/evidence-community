"use client";
import { Spinner } from "@/components/nextui/Spinner";
import {
	AlertCircleIcon,
	CircleIcon,
	Loading03Icon,
	RefreshIcon,
	Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { useAdminPublication } from "./useAdminPublication";
import { useAdminSession } from "./AdminSessionProvider";
import type { AdminReviewSnapshot } from "./admin-api";
import type { AdminPublicationProviderView } from "@/lib/publication/admin-publication-view";

type StepState = "done" | "running" | "failed" | "pending";
type ProgressStep = { label: string; detail: string; state: StepState; status: string };

const STEP_TILE: Record<StepState, string> = {
	done: "bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-400",
	running: "bg-accent/[0.08] text-accent",
	failed: "bg-rose-500/[0.08] text-rose-700 dark:text-rose-300",
	pending: "bg-black/[0.04] text-black/40 dark:bg-white/[0.06] dark:text-white/45",
};

function stepState(provider: AdminPublicationProviderView): StepState {
	if (provider.displayState === "synced") return "done";
	if (["working", "verifying"].includes(provider.displayState)) return "running";
	if (["failed", "blocked"].includes(provider.displayState)) return "failed";
	return "pending";
}

function providerStep(provider: AdminPublicationProviderView): ProgressStep {
	const state = stepState(provider);
	return {
		label: provider.provider === "crossref" ? "Register Crossref DOI" : "Archive files on Zenodo",
		detail: state === "failed" ? (provider.blockers[0] ?? provider.exact.job?.lastError ?? provider.status.description) : provider.status.description,
		state,
		status: provider.status.label,
	};
}

function header(steps: ProgressStep[]) {
	if (steps.some((step) => step.state === "failed")) return { icon: AlertCircleIcon, label: "Needs attention", className: "text-rose-700 dark:text-rose-300", spin: false };
	if (steps.every((step) => step.state === "done")) return { icon: Tick01Icon, label: "Published", className: "text-emerald-700 dark:text-emerald-400", spin: false };
	return { icon: Loading03Icon, label: "Publishing", className: "text-accent", spin: true };
}

function StepIcon({ step }: { step: ProgressStep }) {
	if (step.state === "running") return <Spinner size="sm" classNames={{ wrapper: "h-4 w-4" }} />;
	return <HugeiconsIcon icon={step.state === "done" ? Tick01Icon : step.state === "failed" ? AlertCircleIcon : CircleIcon} size={15} />;
}

function PublicationStep({ step }: { step: ProgressStep }) {
	return (
		<div className="flex items-start gap-2.5 rounded-lg px-2 py-2.5">
			<span className={`grid size-8 shrink-0 place-items-center rounded-lg ${STEP_TILE[step.state]}`}><StepIcon step={step} /></span>
			<span className="min-w-0 flex-1">
				<span className="flex items-baseline justify-between gap-3">
					<span className="text-xs font-medium">{step.label}</span>
					<span className={`shrink-0 text-[11px] ${step.state === "failed" ? "font-medium text-rose-700 dark:text-rose-300" : "text-black/45 dark:text-white/45"}`}>{step.status}</span>
				</span>
				<span role={step.state === "failed" ? "alert" : undefined} className={`mt-0.5 block text-[11px] leading-relaxed ${step.state === "failed" ? "text-rose-700 dark:text-rose-300" : "text-black/50 dark:text-white/55"}`}>{step.detail}</span>
			</span>
		</div>
	);
}

export function ReviewPublicationProgress({ snapshot }: { snapshot: Pick<AdminReviewSnapshot, "key" | "reviewRevision" | "publishing"> }) {
	const { canPublish } = useAdminSession();
	const state = useAdminPublication(snapshot.key, String(snapshot.reviewRevision));
	const providers = state.publication ? [state.publication.providers.crossref, state.publication.providers.zenodo].filter((provider) => provider.exact.targetActive) : [];
	const steps: ProgressStep[] = [
		{ label: "Publish in library", detail: "The submitted version is public. Later draft edits stay private.", state: "done", status: "Done" },
		...providers.map(providerStep),
	];
	const requestError = state.actionError ?? state.error;
	const retryable = providers.filter((provider) => provider.capabilities.canRetry);
	const retry = async () => {
		for (const provider of retryable) {
			const success = await (provider.provider === "crossref" ? state.retryCrossref() : state.retryZenodo());
			if (!success) break;
		}
	};
	if (snapshot.publishing && !state.publication && !requestError) return null;
	const summary = header(steps);
	return (
		<section aria-label="Publication progress" aria-live="polite" className="mt-4 overflow-hidden rounded-xl bg-black/[0.025] ring-1 ring-inset ring-black/[0.05] dark:bg-white/[0.035] dark:ring-white/[0.06]">
			<div className="flex items-center gap-2 px-3 py-3 text-xs font-semibold">
				<HugeiconsIcon icon={summary.icon} size={15} className={`${summary.className} ${summary.spin ? "animate-spin motion-reduce:animate-none" : ""}`} />
				<span className="flex-1">Publishing</span>
				<span className={`text-[11px] font-medium ${summary.className}`}>{summary.label}</span>
			</div>
			<div className="p-1.5 pt-0">
				{steps.map((step) => <PublicationStep key={step.label} step={step} />)}
				{requestError && <p role="alert" className="px-2 py-2 text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">{requestError}</p>}
				{canPublish && retryable.length > 0 && (
					<div className="px-2 pb-1 pt-1.5">
						<Button size="xs" variant="muted" className="h-9 rounded-xl px-3" startContent={<HugeiconsIcon icon={RefreshIcon} size={14} />} isDisabled={state.isMutating} onPress={() => { void retry(); }}>
							Retry publishing
						</Button>
					</div>
				)}
			</div>
		</section>
	);
}
