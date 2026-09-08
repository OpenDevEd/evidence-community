"use client";
import type { AdminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import { useRef, useState } from "react";
import { ModalBody, ModalContent, ModalFooter, ModalHeader } from "@nextui-org/react";
import { SentIcon, Tick01Icon, Cancel01Icon, Comment01Icon, AlertCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Textarea } from "@/components/nextui/Textarea";
import DialogModal from "@/components/nextui/DialogModal";
import { toast } from "sonner";
import { useAdminSession } from "./AdminSessionProvider";
import { approveAdminReview, updateAdminReview, type AdminReviewSnapshot } from "./admin-api";
export function ReviewActions({ snapshot, onUpdated, disabled = false }: { disabled?: boolean; snapshot: AdminReviewSnapshot; onUpdated: (receipts?: readonly AdminSearchIndexReceipt[]) => void }) {
 const { role } = useAdminSession();
 const [dialog, setDialog] = useState<"publish" | "changes" | null>(null);
 const [feedback, setFeedback] = useState("");
 const [error, setError] = useState("");
 const [busy, setBusy] = useState(false);
 const pending = useRef(false);
 const checks = [{label: "Submitted version", ready: snapshot.reviewState === "pending"}];
 const submit = async () => {
   if (pending.current || disabled) return;
   pending.current = true; setBusy(true); setError("");
   try {
     let receipts: readonly AdminSearchIndexReceipt[] = [];
     if (dialog === "publish") receipts = (await approveAdminReview(snapshot.reviewId, snapshot.reviewRevision)).indexingReceipts;
     else await updateAdminReview(snapshot.reviewId, {action: "returned", expectedRevision: snapshot.reviewRevision, note: feedback.trim()});
     setDialog(null); setFeedback(""); onUpdated(receipts);
     toast.success(dialog === "publish" ? "Submitted version published" : "Changes requested");
   } catch (error) { setError(error instanceof Error ? error.message : "Could not update review"); }
   finally { pending.current = false; setBusy(false); }
 };
 if (snapshot.reviewState !== "pending") return null;
 return (<>
			{role !== "creator" ? (
				<div className="mt-4 flex flex-wrap gap-2">
					<Button
						size="xs"
						color="accent"
						className="h-9 rounded-xl px-3 font-semibold"
						startContent={
							<HugeiconsIcon icon={SentIcon} size={14} />
						}
						isDisabled={disabled}
						onPress={() => setDialog("publish")}
					>
						Publish version
					</Button>
					<Button
						size="xs"
						variant="transparent"
						className="h-9 rounded-xl px-2.5"
						startContent={
							<HugeiconsIcon icon={Comment01Icon} size={14} />
						}
						isDisabled={disabled}
						onPress={() => {
							setError("");
							setDialog("changes");
						}}
					>
						Request changes
					</Button>
				</div>
			) : (
				<p className="mt-3 text-[11px] text-black/45 dark:text-white/45">
					An editor will review this version before publishing.
				</p>
			)}
			<DialogModal
				isOpen={Boolean(dialog)}
				onOpenChange={(open) => {
					if (!open && !busy) setDialog(null);
				}}
				size="md"
			>
				<ModalContent>
					<ModalHeader className="flex items-center justify-between gap-3">
						{dialog === "publish"
							? "Publish submitted version"
							: "Request changes"}
						<Button
							isIconOnly
							size="xs"
							variant="transparent"
							aria-label="Close review"
							isDisabled={busy}
                            onPress={() => setDialog(null)}
						>
							<HugeiconsIcon icon={Cancel01Icon} size={16} />
						</Button>
					</ModalHeader>
					<ModalBody className="gap-4">
                        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
						<div>
							<p className="text-sm font-medium leading-relaxed">
								{snapshot.title}
							</p>
							<p className="mt-1 text-xs text-black/45 dark:text-white/45">
								Submitted{" "}
								{new Date(
									snapshot.submittedAt,
								).toLocaleString()}
							</p>
						</div>
						{dialog === "changes" ? (
							<Textarea
								label="What needs to change?"
								placeholder="Describe the changes needed before publication"
								minRows={4}
								value={feedback}
								onValueChange={setFeedback}
								isInvalid={Boolean(error)}
								errorMessage={error}
							/>
						) : (
							<>
								<div className="overflow-hidden rounded-xl bg-black/[0.025] dark:bg-white/[0.035]">
									{checks.map((check) => (
										<div
											key={check.label}
											className="flex items-center gap-2.5 px-3 py-2.5 text-xs"
										>
											<HugeiconsIcon
												icon={
													check.ready
														? Tick01Icon
														: AlertCircleIcon
												}
												size={15}
												className={
													check.ready
														? "text-emerald-600 dark:text-emerald-400"
														: "text-danger"
												}
											/>
											<span>{check.label}</span>
											<span className="ml-auto text-black/40 dark:text-white/40">
												{check.ready
													? "Ready"
													: "Missing"}
											</span>
										</div>
									))}
								</div>
								<p className="text-xs leading-relaxed text-black/55 dark:text-white/55">
									This submitted version will become public. Later working-draft edits stay private.
								</p>

							</>
						)}
					</ModalBody>
					<ModalFooter>
						<Button
							size="sm"
							variant="transparent"
							isDisabled={busy}
                            onPress={() => setDialog(null)}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							color="accent"
							isDisabled={
                                disabled ||
								busy || (dialog === "publish" ? checks.some((c) => !c.ready) : !feedback.trim())
							}
                            onPress={() => void submit()}
						>
							{dialog === "publish"
								? "Publish version"
								: "Send feedback"}
						</Button>
					</ModalFooter>
				</ModalContent>
			</DialogModal>
		</>
	);
}
