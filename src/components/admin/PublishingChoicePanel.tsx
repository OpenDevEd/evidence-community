"use client";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Link01Icon } from "@hugeicons/core-free-icons";
import { InspectorChoices } from "./InspectorChoices";
import { Switch } from "@/components/nextui/Switch";
import { CrossrefIcon } from "@/components/icons/CrossrefIcon";
import { ZenodoIcon } from "@/components/icons/ZenodoIcon";
import type { AdminItemDetail } from "@/lib/admin/types";
import type { PublishingChoice, PublishingChoiceState } from "@/lib/admin/review-contract";
import type { usePublishingChoice } from "./usePublishingChoice";
import { CrossrefIdentifierControls } from "./CrossrefIdentifierControls";
import { PublicationArchiveFiles } from "./PublicationArchiveFiles";
import { Tooltip } from "@/components/nextui/Tooltip";
import { zenodoPolicyChangeReason } from "@/lib/publication/identifier-policy";

function defaultPublishingChoice(lockedPolicy: PublishingChoiceState["lockedIdentifierPolicy"] | undefined): PublishingChoice {
	return lockedPolicy === "reuse-crossref"
		? { route: "crossref-zenodo", identifierPolicy: "reuse-crossref" }
		: { route: "zenodo", identifierPolicy: "mint-zenodo" };
}

export function PublishingChoicePanel({
	detail,
	readOnly = false,
	filesReadOnly,
	choice,
	model,
}: {
	detail: AdminItemDetail;
	readOnly?: boolean;
	filesReadOnly: boolean;
	choice?: PublishingChoice | null;
	model: ReturnType<typeof usePublishingChoice>;
}) {
	const { saved, reservation, saving, save, onReserve } = model;
	const value = choice === undefined ? saved.data?.choice : choice;
	const route = value?.route;
	const enabled = Boolean(value);
	const lockedPolicy = saved.data?.lockedIdentifierPolicy;
	const crossrefPolicy = lockedPolicy === "mint-zenodo" ? "mint-zenodo" : "reuse-crossref";
	const controlsDisabled =
		readOnly || saving || saved.isLoading || Boolean(saved.error);
	const setRoute = (route: string) =>
		void save(
			route === "zenodo"
				? { route, identifierPolicy: "mint-zenodo" }
				: {
						route: "crossref-zenodo",
						identifierPolicy: crossrefPolicy,
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
			<IdentifierError model={model} />
			<div className="flex items-center justify-between gap-3 px-3 py-3">
				<span className="text-xs font-medium text-black/80 dark:text-white/85">
					Register a DOI
				</span>
				<Tooltip
					content="Identifiers have already been activated for this item."
					isDisabled={!(enabled && saved.data?.canClear === false)}
				>
					<span className="inline-flex">
						<Switch
							aria-label="Register a DOI"
							color="accent"
							isSelected={enabled}
							isDisabled={
								controlsDisabled ||
								(enabled && saved.data?.canClear === false)
							}
							onValueChange={(selected) => {
								void save(
									selected ? defaultPublishingChoice(lockedPolicy) : null,
								);
							}}
						/>
					</span>
				</Tooltip>
			</div>
			{!enabled ? (
				<p className="px-3 pb-3 text-[11px] leading-relaxed text-black/50 dark:text-white/50">
					Publish without a DOI or Zenodo archive.
				</p>
			) : (
				<>
					<InspectorChoices
						label="DOI provider"
						value={route}
						onChange={setRoute}
						disabled={controlsDisabled}
						options={[
							{
								key: "zenodo",
								disabledReason: zenodoPolicyChangeReason(lockedPolicy, "mint-zenodo"),
								label: "Zenodo",
								content: (
									<ZenodoIcon
										className="h-4 w-12"
										aria-hidden
									/>
								),
							},
							{
								key: "crossref-zenodo",
								disabledReason: zenodoPolicyChangeReason(lockedPolicy, crossrefPolicy),
								label: "Crossref + Zenodo",
								content: (
									<>
										<CrossrefIcon className="h-4 w-3 shrink-0" />
										<span className="whitespace-nowrap">
											Crossref +
										</span>
										<ZenodoIcon
											className="h-3 w-9"
											aria-hidden
										/>
									</>
								),
							},
						]}
					/>
					<p className="px-3 py-3 text-[11px] leading-relaxed text-black/50 dark:text-white/50">
						{route === "crossref-zenodo"
							? "Register with Crossref. Archive the files on Zenodo."
							: "Archive the files and receive a Zenodo DOI."}
					</p>
					<div>
						{route === "crossref-zenodo" && (
							<CrossrefIdentifierControls
								reservation={reservation.data}
								policy={value?.identifierPolicy}
								lockedPolicy={lockedPolicy}
								readOnly={readOnly}
								saving={saving}
								onReserve={onReserve}
								setPolicy={setPolicy}
							/>
						)}
						<PublicationArchiveFiles
							attachments={detail.attachments}
							readOnly={filesReadOnly}
						/>
					</div>
				</>
			)}
		</div>
	);
}

function IdentifierError({
	model,
}: {
	model: ReturnType<typeof usePublishingChoice>;
}) {
	const { error, saved, reservation } = model;
	return (
		<>
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
		</>
	);
}
