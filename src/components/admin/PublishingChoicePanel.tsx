"use client";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import {
	ArchiveIcon,
	Link01Icon,
	FingerPrintIcon,
} from "@hugeicons/core-free-icons";
import type { AdminItemDetail } from "@/lib/admin/types";
import type { PublishingChoice } from "@/lib/admin/review-contract";
import { usePublishingChoice } from "./usePublishingChoice";
import { CrossrefIdentifierControls } from "./CrossrefIdentifierControls";
import { PublicationArchiveFiles } from "./PublicationArchiveFiles";
export function PublishingChoicePanel({
	detail,
	readOnly = false,
	choice,
}: {
	detail: AdminItemDetail;
	readOnly?: boolean;
	choice?: PublishingChoice | null;
}) {
	const { saved, reservation, saving, error, save, onReserve } =
		usePublishingChoice(detail, readOnly);
	const value = readOnly ? choice : saved.data;
	const route = value?.route;
	const setRoute = (route: string) =>
		void save(
			route === "zenodo"
				? { route, identifierPolicy: "mint-zenodo" }
				: {
						route: "crossref-zenodo",
						identifierPolicy: "reuse-crossref",
					},
		);
	const setPolicy = (identifierPolicy: "reuse-crossref" | "mint-zenodo") =>
		void save({ route: "crossref-zenodo", identifierPolicy });
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
	return (
		<div className="overflow-hidden rounded-xl bg-black/[0.025] ring-1 ring-inset ring-black/[0.05] dark:bg-white/[0.035] dark:ring-white/[0.06]">
			{(error || saved.error || reservation.error) && (
				<p role="alert" className="px-3 pt-3 text-xs text-danger">
					{error ??
						(saved.error instanceof Error
							? saved.error.message
							: reservation.error instanceof Error
								? reservation.error.message
								: "Could not load identifier choice")}
				</p>
			)}
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
						className={`relative flex min-w-0 flex-1 items-center justify-center gap-2 px-2 py-3 text-[11px] font-medium transition-background-text outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${route === option.key ? "bg-black/[0.045] text-black/85 dark:bg-white/[0.045] dark:text-white/85" : "text-black/50 hover:text-black/80 dark:text-white/50 dark:hover:text-white/80"}`}
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
				{!route
					? "Choose an identifier route for this item."
					: route === "crossref-zenodo"
						? "Register with Crossref. Archive the files on Zenodo."
						: "Archive the files and receive a Zenodo DOI."}
			</p>
			<div>
				{route === "crossref-zenodo" && (
					<CrossrefIdentifierControls
						reservation={reservation.data}
						policy={value?.identifierPolicy}
						readOnly={readOnly}
						saving={saving}
						onReserve={onReserve}
						setPolicy={setPolicy}
					/>
				)}
				<PublicationArchiveFiles attachments={detail.attachments} />
			</div>
		</div>
	);
}
