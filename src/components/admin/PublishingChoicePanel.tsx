"use client";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArrowRight01Icon, LicenseIcon, Link01Icon, LinkSquare02Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { licenceComplete, licenceLabel, zenodoLicenceTitle, type RecordLicence } from "@/lib/licences";
import { InspectorChoices } from "./InspectorChoices";
import { Switch } from "@/components/nextui/Switch";
import { Button } from "@/components/nextui/Button";
import { CrossrefIcon } from "@/components/icons/CrossrefIcon";
import { ZenodoIcon } from "@/components/icons/ZenodoIcon";
import type { AdminItemDetail } from "@/lib/admin/types";
import type { PublishingChoice, PublishingChoiceState } from "@/lib/admin/review-contract";
import type { usePublishingChoice } from "./usePublishingChoice";
import { CrossrefIdentifierControls } from "./CrossrefIdentifierControls";
import { PublicationArchiveFiles } from "./PublicationArchiveFiles";
import { Tooltip } from "@/components/nextui/Tooltip";
import { zenodoPolicyChangeReason } from "@/lib/publication/identifier-policy";
import { useAdminSession } from "./AdminSessionProvider";

/** Said in place of a DOI choice the community can't make: every DOI here is archived on Zenodo. */
const NO_DOI_PROVIDER = "This community hasn't set up Zenodo, so it can't register DOIs. Records publish without one.";
/** Said beside a DOI choice saved before Zenodo was switched off: it stays in view so it can be switched off. */
export function ZenodoOff({ className }: { className: string }) {
	return useAdminSession().doiProviders.zenodo ? null : (
		<p role="alert" className={className}>
			This community hasn&apos;t set up Zenodo, so nothing can publish with a DOI. Switch this off to publish without one.
		</p>
	);
}

/** Whether a DOI choice shows: where Zenodo is set up, or to switch off a route chosen before it was switched off. */
export function useDoiOffer(chosen: boolean) {
	const { doiProviders } = useAdminSession();
	return { crossref: doiProviders.crossref, shown: doiProviders.zenodo || chosen };
}
const NO_CROSSREF = "This community hasn't set up Crossref.";

function defaultPublishingChoice(lockedPolicy: PublishingChoiceState["lockedIdentifierPolicy"] | undefined): PublishingChoice {
	return lockedPolicy === "reuse-crossref"
		? { route: "crossref-zenodo", identifierPolicy: "reuse-crossref" }
		: { route: "zenodo", identifierPolicy: "mint-zenodo" };
}

/** The two ways a record made in the library gets its DOI, shared with the import's Publish step. */
export function doiProviderOptions(
	lockedPolicy: PublishingChoiceState["lockedIdentifierPolicy"] | undefined,
	crossrefPolicy: "reuse-crossref" | "mint-zenodo",
	/** Whether the community has set up Crossref: without it, only Zenodo is offered to choose. */
	crossref: boolean,
) {
	return [
		{
			key: "zenodo",
			disabledReason: zenodoPolicyChangeReason(lockedPolicy, "mint-zenodo"),
			label: "Zenodo",
			content: <ZenodoIcon className="h-4 w-12" aria-hidden />,
		},
		{
			key: "crossref-zenodo",
			disabledReason: crossref ? zenodoPolicyChangeReason(lockedPolicy, crossrefPolicy) : NO_CROSSREF,
			label: "Crossref + Zenodo",
			content: (
				<>
					<CrossrefIcon className="h-4 w-3 shrink-0" />
					<span className="whitespace-nowrap">Crossref +</span>
					<ZenodoIcon className="h-3 w-9" aria-hidden />
				</>
			),
		},
	] as const;
}

/** What publishing does on each route, under the provider choice. */
export const DOI_PROVIDER_HELP = {
	zenodo: "Archive the files and receive a Zenodo DOI.",
	"crossref-zenodo": "Register with Crossref. Archive the files on Zenodo.",
} as const;

type PanelProps = {
	detail: AdminItemDetail;
	readOnly?: boolean;
	filesReadOnly: boolean;
	choice?: PublishingChoice | null;
	model: ReturnType<typeof usePublishingChoice>;
	/** The record is to get a DOI and has no licence yet. */
	licenceMissing?: boolean;
	/** The licence its DOI goes out under; null for a record that came from elsewhere. */
	licence?: RecordLicence | null;
	/** The DOI Zenodo gave the record, once it has one. */
	zenodoDoi?: { value: string; url: string } | null;
};

/** A record's DOI: kept as it came, chosen here, or not on offer in a community that hasn't set up Zenodo. */
export function RecordDoiPanel(props: PanelProps) {
	const { saved, saving } = props.model;
	const chosen = props.choice === undefined ? saved.data?.choice : props.choice;
	const offer = useDoiOffer(Boolean(chosen));
	if (props.detail.kind === "imported") return <ExistingPublication />;
	if (!offer.shown)
		return <p className="py-1 text-[11px] leading-relaxed text-black/50 dark:text-white/50">{NO_DOI_PROVIDER}</p>;
	return (
		<PublishingChoicePanel
			detail={props.detail}
			readOnly={props.readOnly ?? false}
			filesReadOnly={props.filesReadOnly}
			value={chosen ?? null}
			disabled={props.readOnly || saving || saved.isLoading || Boolean(saved.error)}
			model={props.model}
			crossref={offer.crossref}
			licenceMissing={props.licenceMissing ?? false}
			licence={props.licence ?? null}
			zenodoDoi={props.zenodoDoi ?? null}
		/>
	);
}

function ExistingPublication() {
	return (
		<div className="flex items-start gap-3 py-1">
			<HugeiconsIcon icon={Link01Icon} size={17} className="mt-0.5 text-black/35 dark:text-white/35" />
			<div>
				<p className="text-xs font-medium">Existing publication</p>
				<p className="mt-1 text-[11px] leading-relaxed text-black/45 dark:text-white/45">
					Keeps its original DOI. No new archive required.
				</p>
			</div>
		</div>
	);
}

function PublishingChoicePanel({
	detail,
	readOnly,
	filesReadOnly,
	value,
	disabled,
	model,
	crossref,
	licenceMissing,
	licence,
	zenodoDoi,
}: Pick<PanelProps, "detail" | "filesReadOnly" | "model"> & {
	licenceMissing: boolean;
	licence: RecordLicence | null;
	zenodoDoi: { value: string; url: string } | null;
	readOnly: boolean;
	/** The route chosen: the saved one, or a submitted version's. */
	value: PublishingChoice | null;
	/** Nothing here can be changed now: read-only, saving, or not loaded. */
	disabled: boolean;
	crossref: boolean;
}) {
	const { saved, save } = model;
	const lockedPolicy = saved.data?.lockedIdentifierPolicy;
	const held = Boolean(value) && saved.data?.canClear === false;
	return (
		<div className="overflow-hidden rounded-xl bg-black/[0.025] ring-1 ring-inset ring-black/[0.05] dark:bg-white/[0.035] dark:ring-white/[0.06]">
			<IdentifierError model={model} />
			{/* The words are the switch's own label, so pressing them turns it, as the admin's display switches do. */}
			<Tooltip
				content="Identifiers have already been activated for this item."
				isDisabled={!held}
			>
				<div className="px-3 py-3">
					<Switch
						color="accent"
						isSelected={Boolean(value)}
						isDisabled={disabled || held}
						onValueChange={(selected) => {
							void save(
								selected ? defaultPublishingChoice(lockedPolicy) : null,
							);
						}}
						classNames={{
							base: "flex w-full max-w-none justify-between",
							label: "ms-0 text-xs font-medium text-black/80 dark:text-white/85",
							wrapper: "shrink-0",
						}}
					>
						Register a DOI
					</Switch>
				</div>
			</Tooltip>
			{value && licenceMissing ? <NoLicence fieldId={`admin-${detail.key}-licence`} /> : null}
			{value ? (
				<ChosenRoute value={value} detail={detail} readOnly={readOnly} filesReadOnly={filesReadOnly} disabled={disabled} model={model} crossref={crossref} licence={licence} zenodoDoi={zenodoDoi} />
			) : (
				<p className="px-3 pb-3 text-[11px] leading-relaxed text-black/50 dark:text-white/50">
					Publish without a DOI or Zenodo archive.
				</p>
			)}
		</div>
	);
}

/** The provider a record's DOI comes from, and what that provider needs: a reserved Crossref DOI, and the files to archive. */
function ChosenRoute({
	value,
	detail,
	readOnly,
	filesReadOnly,
	disabled,
	model,
	crossref,
	licence,
	zenodoDoi,
}: {
	licence: RecordLicence | null;
	zenodoDoi: { value: string; url: string } | null;
	value: PublishingChoice;
	detail: AdminItemDetail;
	readOnly: boolean;
	filesReadOnly: boolean;
	disabled: boolean;
	model: ReturnType<typeof usePublishingChoice>;
	crossref: boolean;
}) {
	const { saved, reservation, saving, save, onReserve } = model;
	const lockedPolicy = saved.data?.lockedIdentifierPolicy;
	const crossrefPolicy = lockedPolicy === "mint-zenodo" ? "mint-zenodo" : "reuse-crossref";
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
	return (
		<>
			<InspectorChoices
				label="DOI provider"
				value={value.route}
				onChange={setRoute}
				disabled={disabled}
				options={doiProviderOptions(lockedPolicy, crossrefPolicy, crossref)}
			/>
			<p className="px-3 py-3 text-[11px] leading-relaxed text-black/50 dark:text-white/50">
				{DOI_PROVIDER_HELP[value.route]}
			</p>
			<div>
				{value.route === "crossref-zenodo" && (
					<CrossrefIdentifierControls
						reservation={reservation.data}
						policy={value.identifierPolicy}
						lockedPolicy={lockedPolicy}
						readOnly={readOnly}
						saving={saving}
						onReserve={onReserve}
						setPolicy={setPolicy}
					/>
				)}
				{value.route === "zenodo" && <ZenodoDoi doi={zenodoDoi} />}
				<PublicationArchiveFiles
					attachments={detail.attachments}
					readOnly={filesReadOnly}
				/>
				{licenceComplete(licence) ? <LicenceRow licence={licence} fieldId={`admin-${detail.key}-licence`} /> : null}
			</div>
		</>
	);
}

/** The DOI Zenodo gave the record, shown as the Crossref DOI is on its route; until then, when it comes. */
function ZenodoDoi({ doi }: { doi: { value: string; url: string } | null }) {
	return (
		<div className="flex items-center gap-3 border-t border-black/[0.05] p-3 dark:border-white/[0.06]">
			<span className="grid size-8 shrink-0 place-items-center self-start rounded-lg bg-card_light dark:bg-white/5">
				<ZenodoIcon className="h-3 w-7" aria-hidden />
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-xs font-medium">Zenodo DOI</p>
				{doi ? (
					<a href={doi.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 break-all font-mono text-[10px] leading-relaxed text-black/55 underline-offset-2 hover:underline dark:text-white/55">
						{doi.value}
						<HugeiconsIcon icon={LinkSquare02Icon} size={11} className="shrink-0" />
					</a>
				) : (
					<p className="mt-1 text-[10px] leading-relaxed text-black/45 dark:text-white/45">Given when the record publishes.</p>
				)}
			</div>
			{doi ? (
				<span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
					<HugeiconsIcon icon={Tick01Icon} size={12} />
					Active
				</span>
			) : null}
		</div>
	);
}

/** The licence the DOI goes out under, beside its files; pressing it goes to the Licence field to change it. */
function LicenceRow({ licence, fieldId }: { licence: RecordLicence; fieldId: string }) {
	return (
		<button
			type="button"
			className="group flex w-full items-center gap-3 border-t border-black/[0.05] p-3 text-left transition-background-fill hover:bg-black/[0.03] dark:border-white/[0.06] dark:hover:bg-white/[0.04]"
			onClick={() => focusField(fieldId)}
		>
			<span className="grid size-8 shrink-0 place-items-center self-start rounded-lg bg-card_light text-black/50 dark:bg-white/5 dark:text-white/55">
				<HugeiconsIcon icon={LicenseIcon} size={16} />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block text-xs font-medium">{licenceLabel(licence)}</span>
				<span className="mt-1 block truncate text-[10px] text-black/45 dark:text-white/45">
					{licence.kind === "custom" ? licence.url : zenodoLicenceTitle(licence.id)}
				</span>
			</span>
			<span className="shrink-0 text-[11px] font-medium text-black/50 dark:text-white/55">Change</span>
			<HugeiconsIcon icon={ArrowRight01Icon} size={13} className="shrink-0 text-black/30 transition-transform group-hover:translate-x-0.5 dark:text-white/35" />
		</button>
	);
}

/** Brings the record's Licence field into view and puts the cursor in it. */
function focusField(fieldId: string) {
	const field = document.getElementById(fieldId);
	field?.scrollIntoView({ behavior: "smooth", block: "center" });
	field?.focus({ preventScroll: true });
}

/** A DOI needs the record's licence, which Zenodo and Crossref both take: until it has one, it goes to the field. */
function NoLicence({ fieldId }: { fieldId: string }) {
	const pick = () => focusField(fieldId);
	return (
		<div role="alert" className="flex items-center gap-3 px-3 pb-3 text-xs text-danger">
			<p className="min-w-0 flex-1 leading-relaxed">No licence yet. A DOI needs one.</p>
			<Button size="xs" variant="muted" className="shrink-0" onPress={pick}>
				Pick a licence
			</Button>
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
			<ZenodoOff className="px-3 pt-3 text-xs text-danger" />
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
