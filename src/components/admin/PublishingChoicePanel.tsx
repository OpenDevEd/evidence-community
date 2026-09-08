"use client";
import { useRef, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/nextui/Button";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArchiveIcon, Link01Icon, Tick01Icon, ArrowRight01Icon, File01Icon, Add01Icon, FingerPrintIcon } from "@hugeicons/core-free-icons";
import type { AdminItemDetail } from "@/lib/admin/types";
import type { PublishingChoice } from "@/lib/admin/review-contract";
import { getAdminCrossrefReservation, reserveAdminCrossrefDoi, getAdminPublishingChoice, saveAdminPublishingChoice } from "./admin-api";
export function PublishingChoicePanel({ detail, readOnly = false, choice }: {
 detail: AdminItemDetail; readOnly?: boolean; choice?: PublishingChoice | null;
}) {
 const saved = useSWR(!readOnly && detail.kind === "created" ? ["admin-publishing-choice", detail.key] : null, ([, key]) => getAdminPublishingChoice(key));
 const value = readOnly ? choice : saved.data;
 const route = value?.route;
 const policy = value?.identifierPolicy;
 const reservation = useSWR(detail.kind === "created" ? ["admin-crossref-reservation", detail.key] : null, ([, key]) => getAdminCrossrefReservation(key));
 const reservedDoi = reservation.data?.doi;
 const reserved = Boolean(reservedDoi);
 const [saving, setSaving] = useState(false);
 const pending = useRef(false);
 const [error, setError] = useState<string | null>(null);
 const save = async (next: PublishingChoice) => {
   if (pending.current || readOnly) return;
   pending.current = true; setSaving(true); setError(null);
   try { const stored = await saveAdminPublishingChoice(detail.key, next); await saved.mutate(stored, {revalidate: false}); }
   catch (error) { setError(error instanceof Error ? error.message : "Could not save identifier choice"); }
   finally { pending.current = false; setSaving(false); }
 };
 const onReserve = () => {
   if (pending.current || readOnly) return;
   pending.current = true; setSaving(true); setError(null);
   void reserveAdminCrossrefDoi(detail.key).then(result => reservation.mutate(result, {revalidate: false})).catch(error => setError(error instanceof Error ? error.message : "Could not reserve DOI")).finally(() => {pending.current = false; setSaving(false);});
 };
 const setRoute = (route: string) => void save(route === "zenodo" ? {route, identifierPolicy: "mint-zenodo"} : {route: "crossref-zenodo", identifierPolicy: "reuse-crossref"});
 const setPolicy = (identifierPolicy: "reuse-crossref" | "mint-zenodo") => void save({route: "crossref-zenodo", identifierPolicy});
	if (detail.kind === "imported")
		return (
			<div className="flex items-start gap-3 py-1">
				<HugeiconsIcon
					icon={Link01Icon}
					size={17}
					className="mt-0.5 text-black/35 dark:text-white/35"
				/>
				<div>
					<p className="text-xs font-medium">Existing publication</p>
					<p className="mt-1 text-[11px] leading-relaxed text-black/45 dark:text-white/45">
						Keeps its original DOI. No new archive required.
					</p>
				</div>
			</div>
		);
	const files = detail.attachments.filter(
		(a) => !a.fileRemovalPending && (a.fileDraft?.readyAt || a.filePublication),
	).length;

	const readyFiles = detail.attachments.filter(
		(a) => !a.fileRemovalPending && (a.fileDraft?.readyAt || a.filePublication),
	);
	return (
		<div className="overflow-hidden rounded-xl bg-black/[0.025] ring-1 ring-inset ring-black/[0.05] dark:bg-white/[0.035] dark:ring-white/[0.06]">
			{(error || saved.error || reservation.error) && <p role="alert" className="px-3 pt-3 text-xs text-danger">{error ?? (saved.error instanceof Error ? saved.error.message : reservation.error instanceof Error ? reservation.error.message : "Could not load identifier choice")}</p>}
			<div
				role="group"
				aria-label="DOI provider"
				className="flex border-b border-black/[0.06] dark:border-white/[0.07]"
			>
				{[
					{ key: "zenodo", label: "Zenodo", icon: ArchiveIcon },
					{
						key: "crossref-zenodo",
						label: "Crossref + Zenodo",
						icon: FingerPrintIcon,
					},
				].map((option) => (
					<button
						key={option.key}
						type="button"
						disabled={readOnly || saving || saved.isLoading}
						aria-pressed={route === option.key}
						onClick={() => setRoute(option.key)}
						className={`relative flex min-w-0 flex-1 items-center justify-center gap-2 px-2 py-3 text-[11px] font-medium transition-[background-color,color] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${route === option.key ? "bg-black/[0.045] text-black/85 dark:bg-white/[0.045] dark:text-white/85" : "text-black/50 hover:text-black/80 dark:text-white/50 dark:hover:text-white/80"}`}
					>
						<HugeiconsIcon
							icon={option.icon}
							size={15}
							className="shrink-0"
						/>
						<span>{option.label}</span>
					</button>
				))}
			</div>
			<p className="px-3 pb-1 pt-3 text-[11px] leading-relaxed text-black/50 dark:text-white/50">
				{!route ? "Choose an identifier route for this item." : route === "crossref-zenodo"
					? "Register with Crossref. Archive the files on Zenodo."
					: "Archive the files and receive a Zenodo DOI."}
			</p>
			<div>
				{route === "crossref-zenodo" && (
					<>
						<div className="flex items-center gap-3 p-3">
							<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-card_light text-black/50 dark:bg-white/5 dark:text-white/55">
								<HugeiconsIcon icon={Link01Icon} size={16} />
							</span>
							<div className="min-w-0 flex-1">
								<p className="text-xs font-medium">
									Crossref DOI
								</p>
								<p
									className={`mt-1 text-[10px] leading-relaxed text-black/45 dark:text-white/45 ${reserved ? "break-all font-mono" : ""}`}
								>
									{reserved
										? reservedDoi
										: "Registered after approval."}
								</p>
							</div>
							{reserved ? (
								<span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
									<HugeiconsIcon
										icon={Tick01Icon}
										size={12}
									/>
									{reservation.data?.lifecycle === "verified" ? "Registered" : "Reserved"}
								</span>
							) : (
								<Button
									size="xs"
									variant="flat"
									color="accent"
									isDisabled={readOnly || saving}
									onPress={onReserve}
									className="h-8 min-w-0 shrink-0 rounded-lg px-2.5 text-[11px] font-semibold"
									startContent={
										<HugeiconsIcon
											icon={Add01Icon}
											size={13}
										/>
									}
								>
									Reserve DOI
								</Button>
							)}
						</div>
                        <div className="px-3 pb-3">
                            <p className="mb-2 text-[11px] font-medium text-black/70 dark:text-white/70">Zenodo identifier</p>
                            <div role="group" aria-label="Zenodo identifier" className="flex rounded-lg bg-black/[0.035] p-1 dark:bg-white/[0.04]">
                                {[{key: "reuse-crossref" as const, label: "Use Crossref DOI", icon: Link01Icon}, {key: "mint-zenodo" as const, label: "Separate DOI", icon: Add01Icon}].map(option => (
                                    <button key={option.key} type="button" disabled={readOnly || saving} aria-pressed={policy === option.key} onClick={() => setPolicy(option.key)} className={`flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[10px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${policy === option.key ? "bg-white text-black/80 shadow-sm dark:bg-white/[0.08] dark:text-white/85" : "text-black/45 dark:text-white/45"}`}>
                                        <HugeiconsIcon icon={option.icon} size={13}/>{option.label}
                                    </button>
                                ))}
                            </div>
                        </div>
					</>
				)}
				<button
					type="button"
					className="group flex w-full items-center gap-3 border-t border-black/[0.05] p-3 text-left transition-[background-color] hover:bg-black/[0.03] dark:border-white/[0.06] dark:hover:bg-white/[0.04]"
					onClick={() =>
						document
							.getElementById("admin-attachments")
							?.scrollIntoView({
								behavior: "smooth",
								block: "start",
							})
					}
				>
					<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-card_light text-black/50 dark:bg-white/5 dark:text-white/55">
						<HugeiconsIcon icon={File01Icon} size={16} />
					</span>
					<span className="min-w-0 flex-1">
						<span className="block text-xs font-medium">
							{files
								? `${files} ${files === 1 ? "PDF" : "PDFs"} ready to archive`
								: "Add a PDF"}
						</span>
						<span className="mt-1 block truncate text-[10px] text-black/45 dark:text-white/45">
							{files
								? readyFiles
										.map(
											(file) =>
												file.fileDraft?.filename ??
												file.filePublication
													?.filename ??
												file.title,
										)
										.join(", ")
								: "Archive waits for an approved PDF"}
						</span>
					</span>
					{files > 0 && (
						<HugeiconsIcon
							icon={Tick01Icon}
							size={13}
							className="shrink-0 text-emerald-600 dark:text-emerald-400"
						/>
					)}
					<HugeiconsIcon
						icon={ArrowRight01Icon}
						size={13}
						className="shrink-0 text-black/30 transition-transform group-hover:translate-x-0.5 dark:text-white/35"
					/>
				</button>
			</div>
		</div>
	);
}
