"use client";
import { Spinner } from "@/components/nextui/Spinner";
import { RotateLeft01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { useAdminPublication } from "./useAdminPublication";
import { useAdminSession } from "./AdminSessionProvider";
import type { AdminReviewSnapshot } from "./admin-api";

type ProgressStep = { label: string; done: boolean; running: boolean; failed: boolean; status: string };

function StepIcon({step}: {step: ProgressStep}) {
 if (step.done) return <HugeiconsIcon icon={Tick01Icon} size={15} className="text-emerald-600 dark:text-emerald-400" />;
 if (step.running) return <Spinner size="sm" classNames={{ wrapper: "h-4 w-4" }} />;
 return <span className={`size-3.5 rounded-full border ${step.failed ? "border-danger" : "border-black/15 dark:border-white/15"}`} />;
}

function PublicationStep({step}: {step: ProgressStep}) {
 return <div className="flex items-center gap-2.5 text-[11px]">
  <StepIcon step={step} />
  <span className="text-black/80 dark:text-white/80">{step.label}</span>
  {step.status && <span className="ml-auto text-black/35 dark:text-white/35">{step.status}</span>}
 </div>;
}

export function ReviewPublicationProgress({snapshot}: {snapshot: Pick<AdminReviewSnapshot, "key" | "reviewRevision" | "publishing">}) {
 const {role} = useAdminSession();
 const state = useAdminPublication(snapshot.key, String(snapshot.reviewRevision));
 const providers = state.publication ? [state.publication.providers.crossref, state.publication.providers.zenodo].filter(provider => provider.exact.targetActive) : [];
 const steps = [
  {label: "Publish in library", done: true, running: false, failed: false, status: "Done"},
  ...providers.map(provider => ({
   label: provider.provider === "crossref" ? "Register Crossref DOI" : "Archive files on Zenodo",
   done: provider.displayState === "synced",
   running: ["working", "verifying"].includes(provider.displayState),
   failed: provider.displayState === "failed" || provider.displayState === "blocked",
   status: provider.status.label,
  })),
 ];
 const failure = state.actionError ?? state.error ?? providers.filter(provider => ["failed", "blocked"].includes(provider.displayState)).map(provider => provider.exact.job?.lastError ?? provider.status.description).join("; ");
 const retryable = providers.filter(provider => provider.capabilities.canRetry);
 const retry = async () => {
  for (const provider of retryable) {
   const success = await (provider.provider === "crossref" ? state.retryCrossref() : state.retryZenodo());
   if (!success) break;
  }
 };
 if (snapshot.publishing && !state.publication && !failure) return null;
 return (
				<div className="mt-4 space-y-2.5" aria-live="polite">
					{steps.map(step => <PublicationStep key={step.label} step={step} />)}
					{Boolean(failure) && (
						<div className="pt-1">
							<p
								className="text-[11px] leading-relaxed text-danger"
								role="alert"
							>
								{failure}
							</p>
							{role !== "creator" && retryable.length > 0 && (
								<Button
									size="xs"
									variant="light"
									className="mt-2"
									startContent={
										<HugeiconsIcon
											icon={RotateLeft01Icon}
											size={14}
										/>
									}
                                    isDisabled={state.isMutating}
                                    onPress={() => { void retry(); }}
								>
									Retry publishing
								</Button>
							)}
						</div>
					)}
					{!failure && (!snapshot.publishing || Boolean(state.publication)) && steps.every(step => step.done) && (
						<p className="text-[11px] text-emerald-700 dark:text-emerald-400">
							Submitted version published. Later draft edits stay
							private.
						</p>
					)}
				</div>
 );
}
