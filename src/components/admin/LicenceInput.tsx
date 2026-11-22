"use client";

import { AutocompleteItem, AutocompleteSection } from "@nextui-org/react";

import { Autocomplete } from "@/components/nextui/Autocomplete";
import { Button } from "@/components/nextui/Button";
import { Input } from "@/components/nextui/Input";
import { inspectorInputClassNames } from "@/components/nextui/field-styles";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { COMMON_ZENODO_LICENCES, isZenodoLicence, licenceComplete, licenceDescription, licenceFromRights, licenceShortName, licenceTermsUrl, ZENODO_LICENCES, zenodoLicenceTitle, type RecordLicence } from "@/lib/licences";
import { InspectorChoices } from "./InspectorChoices";

const OTHER = "other";

const common = new Set<string>(COMMON_ZENODO_LICENCES);
// A licence is shown by its short name where it has one, with its full title under it in the list: the full titles
// don't fit the editor's width.
type LicenceOption = { key: string; title: string; short: string | null; shown: string; note?: string };
const option = ([id, title]: readonly [string, string, ...string[]]): LicenceOption => {
	const short = licenceShortName(id);
	return { key: id, title, short, shown: short ?? title, note: short ? title : undefined };
};
const SECTIONS = [
	// The licences most records use say what they let people do; the rest go by their full titles.
	{ key: "common", title: "Most used", items: COMMON_ZENODO_LICENCES.map((id) => ({ ...option([id, zenodoLicenceTitle(id)]), note: licenceDescription({ kind: "zenodo", id }) })) },
	{ key: "all", title: "Every licence Zenodo takes", items: ZENODO_LICENCES.filter(([id]) => !common.has(id)).map(option) },
	{ key: "another", title: "Not on Zenodo's list", items: [{ key: OTHER, title: "Another licence", short: null, shown: "Another licence", note: "By its name and link" }] },
];
// What each title can be found by: itself, its id, and its short name, so "cc by-nc" finds the licence.
const SEARCHED = new Map(SECTIONS.flatMap(({ items }) => items.map(({ key, title, short, shown }) => [shown, `${title} ${key} ${short ?? ""}`.toLowerCase()])));

/** A licence by the name the field shows: its short name where it has one. */
const nameOf = (id: string) => licenceShortName(id) ?? zenodoLicenceTitle(id);

/** What the field's button fills in: the licence the record's rights name, edited in after it was made or imported, before the default. */
function offerOf(rights: string, defaultLicence: string) {
	const found = licenceFromRights(rights);
	return found ? { id: found, name: nameOf(found) } : { id: defaultLicence, name: licenceShortName(defaultLicence) ?? "the default" };
}

/**
 * The licence a record's rights name, when its own says otherwise: rights edited to "All rights reserved" after it started
 * with CC BY 4.0. A licence of the record's own goes against rights that name one of Zenodo's, or that keep every right
 * while it is open; a closed one of its own under "All rights reserved" agrees with them.
 */
function contradicted(licence: RecordLicence | null, rights: string) {
	const found = licenceFromRights(rights);
	if (!licence || !found) return null;
	if (licence.kind === "zenodo") return found === licence.id ? null : { found, own: nameOf(licence.id) };
	return licenceComplete(licence) && (found !== "other-closed" || licence.open) ? { found, own: licence.title } : null;
}

/**
 * Where the licence came from, said under the field: its rights, the community's default, or a person. "Its rights"
 * never says "above": the import review has no Rights field to point at.
 */
function originNote(licence: RecordLicence | null, rights: string, defaultLicence: string) {
	const found = licenceFromRights(rights);
	if (!licence) return found ? `Its rights name ${nameOf(found)}.` : rights ? "Its rights name no licence." : "No licence yet.";
	if (licence.kind === "custom") return licenceComplete(licence) ? "Chosen for this record." : "Give its name and a link to its terms.";
	if (licence.id === found) return "Read from its rights.";
	if (licence.id === defaultLicence) return `The community's default licence, ${licenceShortName(defaultLicence) ?? zenodoLicenceTitle(defaultLicence)}. Records made here start with it.`;
	return "Chosen for this record.";
}

/** The note under the field: the licence its rights name when it has another, or else where its licence came from. */
function noteOf(licence: RecordLicence | null, rights: string, defaultLicence: string) {
	const other = contradicted(licence, rights);
	return other ? `Its rights name ${nameOf(other.found)}, not ${other.own}.` : originNote(licence, rights, defaultLicence);
}

/**
 * A record's licence: one of Zenodo's, or another by its name and link. It is what Zenodo and Crossref get for the
 * record's DOI, so a record with none can't get one. Shaped like the Study type field: the search, then where the
 * licence came from.
 */
export function LicenceInput({
	id,
	value: licence,
	rights,
	defaultLicence,
	needed,
	disabled = false,
	onChange,
}: {
	/** The search box's id, which the record editor's requirements and the DOI panel go to. */
	id?: string;
	value: RecordLicence | null;
	/** The record's rights statement, as it came or as edited. */
	rights: string;
	/** The community's default licence, by its Zenodo id. */
	defaultLicence: string;
	/** The record is to get a DOI, which needs a licence. */
	needed: boolean;
	disabled?: boolean;
	onChange: (licence: RecordLicence) => void;
}) {
	// A licence of its own starts as not open: until someone says it lets anyone share the work, its file stays private.
	const custom = licence?.kind === "custom" ? licence : { kind: "custom" as const, title: "", url: "", open: false };
	const selectedKey = licence ? (licence.kind === "custom" ? OTHER : licence.id) : null;
	const missing = needed && !licenceComplete(licence);
	const offer = offerOf(rights, defaultLicence);
	return (
		<section
			aria-label="Licence"
			className={`@container/licence overflow-hidden rounded-2xl border bg-black/[0.025] dark:bg-white/[0.025] ${missing ? "border-danger/40" : "border-black/[0.07] dark:border-white/[0.07]"}`}
		>
			<div className="space-y-2 p-2">
				<Autocomplete
					aria-label="Licence"
					allowsCustomValue={false}
					className="max-w-none"
					classNames={{ listboxWrapper: "max-h-80" }}
					defaultFilter={(text, input) => (SEARCHED.get(text) ?? text.toLowerCase()).includes(input.toLowerCase().trim())}
					id={id}
					inputProps={{ classNames: inspectorInputClassNames }}
					isClearable={false}
					isDisabled={disabled}
					isInvalid={missing}
					menuTrigger="focus"
					placeholder="Find a licence"
					selectedKey={selectedKey}
					onSelectionChange={(key) => {
						// Only an option counts: Enter with none highlighted hands over what was typed.
						if (typeof key !== "string" || (key !== OTHER && !isZenodoLicence(key))) return;
						// "Another licence" starts empty: until it has a name and a link, a DOI waits for it.
						if (key !== selectedKey) onChange(key === OTHER ? custom : { kind: "zenodo", id: key });
					}}
				>
					{SECTIONS.map((section) => (
						<AutocompleteSection key={section.key} title={section.title} classNames={{ heading: "px-1.5 text-xs text-black/50 dark:text-white/50" }}>
							{section.items.map((item) => (
								<AutocompleteItem
									key={item.key}
									textValue={item.shown}
									description={item.note}
									classNames={{ wrapper: "min-w-0", title: "w-full truncate text-sm", description: "w-full truncate text-xs text-black/50 dark:text-white/50" }}
								>
									{item.shown}
								</AutocompleteItem>
							))}
						</AutocompleteSection>
					))}
				</Autocomplete>
				{selectedKey === OTHER ? <CustomLicenceFields custom={custom} disabled={disabled} onChange={onChange} /> : null}
				<LicenceSummary licence={licence} />
			</div>
			{/* On a phone at large text (under 14rem of field; a phone's field is 20rem at normal text) the offer goes under the note
			    and takes the row: beside it, half the row left its label "Us…", or a column too narrow for "Other". */}
			<div className="flex flex-col items-start gap-2 px-3.5 pb-3.5 pt-1 sm:flex-row sm:gap-3 @[14rem]/licence:flex-row @[14rem]/licence:gap-3" aria-live="polite">
				<p className={`min-w-0 flex-1 text-xs leading-relaxed ${missing ? "text-danger" : "text-black/50 dark:text-white/50"}`}>
					{noteOf(licence, rights, defaultLicence)}
					{missing ? " A DOI needs one." : null}
				</p>
				{(!licenceComplete(licence) || contradicted(licence, rights)) && !disabled ? (
					// Beside the note the button keeps to half the row, and its label wraps there, never cut: "Use Other (Not Open)" lost
					// its end in Safari's inspector at normal text. One line stays the button's usual height.
					<Button size="xs" variant="muted" className="h-auto min-h-9 min-w-0 max-w-full whitespace-normal py-1.5 sm:max-w-[50%] @[14rem]/licence:max-w-[50%]" onPress={() => onChange({ kind: "zenodo", id: offer.id })}>
						<span className="min-w-0 break-words text-center">Use {offer.name}</span>
					</Button>
				) : null}
			</div>
		</section>
	);
}

type CustomLicence = Extract<RecordLicence, { kind: "custom" }>;

/** A licence of the record's own: its name, the link to its terms, and whether it lets anyone share the work. */
function CustomLicenceFields({ custom, disabled, onChange }: { custom: CustomLicence; disabled: boolean; onChange: (licence: RecordLicence) => void }) {
	return (
		<div className="grid gap-2 animate-fade-in [animation-duration:200ms]">
			<Input
				color="filled"
				aria-label="Licence name"
				classNames={inspectorInputClassNames}
				isDisabled={disabled}
				placeholder="Name"
				// A new value from outside (a revert, another tab) starts the box again from it.
				key={`title:${custom.title}`}
				defaultValue={custom.title}
				onBlur={(event) => {
					const title = event.currentTarget.value.trim();
					if (title !== custom.title) onChange({ ...custom, title });
				}}
			/>
			<Input
				color="filled"
				aria-label="Licence link"
				classNames={inspectorInputClassNames}
				isDisabled={disabled}
				placeholder="https://"
				type="url"
				key={`url:${custom.url}`}
				defaultValue={custom.url}
				onBlur={(event) => {
					const url = event.currentTarget.value.trim();
					if (url !== custom.url) onChange({ ...custom, url });
				}}
			/>
			<InspectorChoices
				label="Is this licence open?"
				value={custom.open ? "open" : "closed"}
				disabled={disabled}
				onChange={(choice) => onChange({ ...custom, open: choice === "open" })}
				options={[
					{ key: "open", label: "Open", content: "Open" },
					{ key: "closed", label: "Not open", content: "Not open" },
				]}
				variant="inset"
			/>
		</div>
	);
}

/** What the licence lets people do, with a link to its terms, once it is chosen whole. */
function LicenceSummary({ licence }: { licence: RecordLicence | null }) {
	if (!licence || !licenceComplete(licence)) return null;
	const terms = licenceTermsUrl(licence);
	return (
		<p className="flex items-start gap-2 px-1.5 pt-0.5 text-xs leading-relaxed text-black/70 dark:text-white/70">
			<span className="min-w-0 flex-1">{licenceDescription(licence)}</span>
			{terms ? (
				<a href={terms} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 font-medium text-accent hover:underline">
					Terms
					<HugeiconsIcon aria-hidden icon={LinkSquare02Icon} size={12} />
				</a>
			) : null}
		</p>
	);
}
