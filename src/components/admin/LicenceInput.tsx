"use client";

import { AutocompleteItem, AutocompleteSection } from "@nextui-org/react";

import { Autocomplete } from "@/components/nextui/Autocomplete";
import { Button } from "@/components/nextui/Button";
import { Input } from "@/components/nextui/Input";
import { inspectorInputClassNames } from "@/components/nextui/field-styles";
import { licenceComplete, type LicenceState, type RecordLicence } from "@/lib/mock/record-licence";
import { COMMON_ZENODO_LICENCES, isZenodoLicence, ZENODO_LICENCES, zenodoLicenceTitle } from "@/lib/publication/zenodo-licences";

const OTHER = "other";

/** A Creative Commons licence's short name, as people write it ("CC BY-NC 4.0"); none for other licences. */
export function licenceShortName(id: string) {
	if (id === "cc0-1.0") return "CC0 1.0";
	const cc = /^cc-(by(?:-(?:nc|nd|sa))*)-(\d\.\d)$/u.exec(id);
	return cc ? `CC ${cc[1]!.toUpperCase()} ${cc[2]}` : null;
}

/** A licence as one line: the short name where it has one, else its title or name. */
export function licenceLabel(licence: RecordLicence) {
	return licence.kind === "custom" ? licence.name : (licenceShortName(licence.id) ?? zenodoLicenceTitle(licence.id));
}

const common = new Set<string>(COMMON_ZENODO_LICENCES);
// A licence is shown by its short name where it has one, with its full title under it in the list: the full titles
// don't fit the editor's width.
type LicenceOption = { key: string; title: string; short: string | null; shown: string; note?: string };
const option = ([id, title]: readonly [string, string]): LicenceOption => {
	const short = licenceShortName(id);
	return { key: id, title, short, shown: short ?? title, note: short ? title : undefined };
};
const SECTIONS = [
	{ key: "common", title: "Most used", items: COMMON_ZENODO_LICENCES.map((id) => option([id, zenodoLicenceTitle(id)])) },
	{ key: "all", title: "Every licence Zenodo takes", items: ZENODO_LICENCES.filter(([id]) => !common.has(id)).map(option) },
	{ key: "another", title: "Not on Zenodo's list", items: [{ key: OTHER, title: "Another licence", short: null, shown: "Another licence", note: "By its name and link" }] },
];
// What each title can be found by: itself, its id, and its short name, so "cc by-nc" finds the licence.
const SEARCHED = new Map(SECTIONS.flatMap(({ items }) => items.map(({ key, title, short, shown }) => [shown, `${title} ${key} ${short ?? ""}`.toLowerCase()])));

/** Where the licence came from, said under the field. */
function originNote({ from, licence }: LicenceState, rights: string, defaultLicence: string) {
	if (from === "default") return `The community's default licence, ${licenceShortName(defaultLicence) ?? zenodoLicenceTitle(defaultLicence)}. Records made here start with it.`;
	if (from === "found") return "Read from its rights above.";
	if (from === "picked") return licenceComplete(licence) ? "Chosen for this record." : "Give its name and a link to its terms.";
	return rights ? "Its rights above name no licence." : "No licence came with its PDF.";
}

/**
 * A record's licence: one of Zenodo's, or another by its name and link. It is what Zenodo and Crossref get for the
 * record's DOI, so a record with none can't get one. Shaped like the Study type field: the search, then where the
 * licence came from.
 */
export function LicenceInput({
	state,
	rights,
	defaultLicence,
	needed,
	disabled = false,
	onChange,
}: {
	state: LicenceState;
	/** The record's rights statement, as it came or as edited. */
	rights: string;
	/** The community's default licence, by its Zenodo id. */
	defaultLicence: string;
	/** The record is to get a DOI, which needs a licence. */
	needed: boolean;
	disabled?: boolean;
	onChange: (licence: RecordLicence) => void;
}) {
	const { licence } = state;
	const custom = licence?.kind === "custom" ? licence : { kind: "custom" as const, name: "", url: "" };
	const selectedKey = licence ? (licence.kind === "custom" ? OTHER : licence.id) : null;
	const missing = needed && !licenceComplete(licence);
	return (
		<section
			aria-label="Licence"
			className={`overflow-hidden rounded-2xl border bg-black/[0.025] dark:bg-white/[0.025] ${missing ? "border-danger/40" : "border-black/[0.07] dark:border-white/[0.07]"}`}
		>
			<div className="space-y-2 p-2">
				<Autocomplete
					aria-label="Licence"
					allowsCustomValue={false}
					className="max-w-none"
					classNames={{ listboxWrapper: "max-h-80" }}
					defaultFilter={(text, input) => (SEARCHED.get(text) ?? text.toLowerCase()).includes(input.toLowerCase().trim())}
					id="admin-record-licence"
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
				{selectedKey === OTHER ? (
					<div className="grid gap-2 animate-fade-in [animation-duration:200ms]">
						<Input
							color="filled"
							aria-label="Licence name"
							classNames={inspectorInputClassNames}
							isDisabled={disabled}
							placeholder="Name"
							defaultValue={custom.name}
							onBlur={(event) => {
								const name = event.currentTarget.value.trim();
								if (name !== custom.name) onChange({ ...custom, name });
							}}
						/>
						<Input
							color="filled"
							aria-label="Licence link"
							classNames={inspectorInputClassNames}
							isDisabled={disabled}
							placeholder="https://"
							type="url"
							defaultValue={custom.url}
							onBlur={(event) => {
								const url = event.currentTarget.value.trim();
								if (url !== custom.url) onChange({ ...custom, url });
							}}
						/>
					</div>
				) : null}
			</div>
			<div className="flex items-start gap-3 px-3.5 pb-3.5 pt-1" aria-live="polite">
				<p className={`min-w-0 flex-1 text-xs leading-relaxed ${missing ? "text-danger" : "text-black/50 dark:text-white/50"}`}>
					{originNote(state, rights, defaultLicence)}
					{missing ? " A DOI needs one." : null}
				</p>
				{!licenceComplete(licence) && !disabled ? (
					<Button size="xs" variant="muted" className="shrink-0" onPress={() => onChange({ kind: "zenodo", id: defaultLicence })}>
						Use {licenceShortName(defaultLicence) ?? "the default"}
					</Button>
				) : null}
			</div>
		</section>
	);
}
