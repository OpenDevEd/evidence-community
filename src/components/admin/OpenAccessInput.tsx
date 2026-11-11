"use client";

import { Link01Icon, LockKeyholeIcon, LockKeyholeOpenIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { InspectorChoices } from "./InspectorChoices";

type Choice = "doi" | "open" | "closed";

const accessName = (value: boolean) => (value ? "open access" : "closed access");
const OWN = [
	{ key: "open", label: "Open", icon: LockKeyholeOpenIcon },
	{ key: "closed", label: "Closed", icon: LockKeyholeIcon },
] as const;
const FROM_DOI = { key: "doi", label: "From the DOI", icon: Link01Icon } as const;

/** What the field says under its choices: what readers see, and what is known about the record besides. */
function hint(value: boolean | null, fromDoi: boolean, lookedUp: boolean | null) {
	if (!fromDoi) {
		if (value !== null) return "Readers see your choice.";
		return lookedUp === null ? "Readers see no open access label until you choose." : `Readers see ${accessName(lookedUp)}, as its source lists it.`;
	}
	const known = lookedUp === null ? "Nothing is listed for this DOI yet." : `This DOI is listed as ${accessName(lookedUp)}.`;
	return value === null ? known : `Readers see your choice. ${known}`;
}

/**
 * Whether a record is open access: an editor's choice, which wins, or what is listed for its DOI. Only a record with
 * a DOI from elsewhere has a listing to follow: one with no DOI, or whose DOI this community registers, is chosen here.
 */
export function OpenAccessInput({
	value,
	fromDoi,
	lookedUp,
	onChange,
	disabled = false,
}: {
	value: boolean | null;
	/** Whether the record has a DOI from elsewhere, so its listing can be followed. */
	fromDoi: boolean;
	/** What is listed for the record, whatever the editor chose; null when nothing is. */
	lookedUp: boolean | null;
	onChange: (value: boolean | null) => void;
	disabled?: boolean;
}) {
	const choice: Choice | undefined = value === null ? (fromDoi ? "doi" : undefined) : value ? "open" : "closed";
	return (
		<section
			aria-label="Open access"
			className="overflow-hidden rounded-2xl border border-black/[0.07] bg-black/[0.025] dark:border-white/[0.07] dark:bg-white/[0.025]"
		>
			<InspectorChoices
				label="Open access"
				value={choice}
				disabled={disabled}
				onChange={(next) => onChange(next === "doi" ? null : next === "open")}
				options={[...(fromDoi ? [FROM_DOI] : []), ...OWN].map(({ key, label, icon }) => ({
					key,
					label,
					content: (
						<>
							<HugeiconsIcon icon={icon} size={14} aria-hidden />
							{label}
						</>
					),
				}))}
			/>
			<p className="px-3.5 pb-3.5 pt-3 text-xs leading-relaxed text-black/50 dark:text-white/50" aria-live="polite">
				{hint(value, fromDoi, lookedUp)}
			</p>
		</section>
	);
}
