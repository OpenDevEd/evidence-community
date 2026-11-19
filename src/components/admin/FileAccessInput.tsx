"use client";

import { useState } from "react";
import { Input } from "@/components/nextui/Input";
import { inspectorInputClassNames } from "@/components/nextui/field-styles";
import { fileAccessModes, fileAccessOf, licenceOpen, utcDay, type FileAccess, type RecordLicence } from "@/lib/licences";
import { InspectorChoices } from "./InspectorChoices";

const LABELS: Record<FileAccess["mode"], string> = {
	open: "Anyone",
	readers: "Readers here",
	embargo: "From a date",
	private: "Editors only",
};

/** What each choice means here and on Zenodo, said under it. The record and its DOI stay public in every case. */
function meaning(access: FileAccess, open: boolean) {
	if (access.mode === "open" && access.asDeposited) return "Anyone can read and download the file, here and on Zenodo, as when it was deposited. Choose another to keep it private.";
	if (access.mode === "open") return "Anyone can read and download the file, here and on Zenodo.";
	if (access.mode === "readers") return "Readers here can read the file. Zenodo keeps it private, as the licence doesn't let anyone share it.";
	if (access.mode === "embargo") {
		const day = new Date(`${access.until}T00:00:00Z`).toLocaleDateString(undefined, { dateStyle: "long", timeZone: "UTC" });
		return `Nobody can download the file until ${day}; then it opens here and on Zenodo by itself. Its record and DOI are public now.`;
	}
	return open
		? "Only the community's editors can open the file. Its record and DOI stay public, and Zenodo keeps the file private."
		: "Only the community's editors can open the file. Zenodo keeps it private, as the licence doesn't let anyone share it.";
}

/** A year from today, where an embargo starts when one is chosen: changed in the date box under it. */
const aYearOn = () => {
	const date = new Date();
	date.setUTCFullYear(date.getUTCFullYear() + 1);
	return utcDay(date);
};

/**
 * Who may get a record's files: its choices follow its licence. An open licence lets them go to anyone, to nobody but
 * the community's editors, or to anyone from a date; one that isn't open keeps them private on Zenodo, and lets the
 * community's readers read them or not. Shaped like the Licence field above it.
 */
export function FileAccessInput({
	licence,
	value,
	disabled = false,
	onChange,
}: {
	licence: RecordLicence | null;
	/** The choice saved, which the licence may not allow; what it then gets is the licence's own. */
	value: FileAccess | null;
	disabled?: boolean;
	onChange: (access: FileAccess) => void;
}) {
	const access = fileAccessOf(licence, value);
	const open = !licence || licenceOpen(licence);
	// Files public as deposited show as such until another choice, which the licence then governs.
	const modes = licence ? [...(access.mode === "open" && access.asDeposited && !licenceOpen(licence) ? (["open"] as const) : []), ...fileAccessModes(licence)] : (["open", "private", "embargo"] as const);
	// The first day an embargo can end on, taken when the field opens.
	const [tomorrow] = useState(() => utcDay(new Date(Date.now() + 24 * 60 * 60 * 1000)));
	return (
		<section aria-label="Who gets the file" className="overflow-hidden rounded-2xl border border-black/[0.07] bg-black/[0.025] dark:border-white/[0.07] dark:bg-white/[0.025]">
			<div className="space-y-2 p-2">
				<InspectorChoices
					label="Who gets the file"
					value={access.mode}
					disabled={disabled}
					onChange={(mode) => onChange(mode === "embargo" ? { mode, until: aYearOn() } : { mode })}
					options={modes.map((mode) => ({ key: mode, label: LABELS[mode], content: LABELS[mode] }))}
					variant="inset"
				/>
				{access.mode === "embargo" ? (
					<Input
						color="filled"
						aria-label="Opens on"
						type="date"
						classNames={inspectorInputClassNames}
						isDisabled={disabled}
						min={tomorrow}
						// A new value from outside (a revert, another tab) starts the box again from it.
						key={access.until}
						defaultValue={access.until}
						onBlur={(event) => {
							const until = event.currentTarget.value;
							if (until && until !== access.until && until >= tomorrow) onChange({ mode: "embargo", until });
						}}
					/>
				) : null}
			</div>
			<p className="px-3.5 pb-3.5 pt-1 text-xs leading-relaxed text-black/50 dark:text-white/50" aria-live="polite">
				{meaning(access, open)}
			</p>
		</section>
	);
}
