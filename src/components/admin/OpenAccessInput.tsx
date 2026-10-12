"use client";

import { LockKeyholeIcon, LockKeyholeOpenIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { InspectorChoices } from "./InspectorChoices";
import { SourceProviderIcon } from "./SourceProviderIcon";

type Choice = "openalex" | "open" | "closed";

const choiceOf = (value: boolean | null): Choice => (value === null ? "openalex" : value ? "open" : "closed");
const accessName = (value: boolean) => (value ? "open access" : "closed access");

/** Whether a record is open access: what OpenAlex says, or an editor's choice, which wins. */
export function OpenAccessInput({
	value,
	fromSources,
	onChange,
	disabled = false,
}: {
	value: boolean | null;
	/** What OpenAlex says, whatever the editor chose; null when it has no answer. */
	fromSources: boolean | null;
	onChange: (value: boolean | null) => void;
	disabled?: boolean;
}) {
	const choice = choiceOf(value);
	return (
		<section
			aria-label="Open access"
			className="overflow-hidden rounded-2xl border border-black/[0.07] bg-black/[0.025] dark:border-white/[0.07] dark:bg-white/[0.025]"
		>
			<InspectorChoices
				label="Open access"
				value={choice}
				disabled={disabled}
				onChange={(next) => onChange(next === "openalex" ? null : next === "open")}
				options={[
					{
						key: "openalex",
						label: "OpenAlex",
						content: (
							<>
								<SourceProviderIcon provider="openalex" size={14} aria-hidden />
								OpenAlex
							</>
						),
					},
					{
						key: "open",
						label: "Open",
						content: (
							<>
								<HugeiconsIcon icon={LockKeyholeOpenIcon} size={14} aria-hidden />
								Open
							</>
						),
					},
					{
						key: "closed",
						label: "Closed",
						content: (
							<>
								<HugeiconsIcon icon={LockKeyholeIcon} size={14} aria-hidden />
								Closed
							</>
						),
					},
				]}
			/>
			<p className="px-3.5 pb-3.5 pt-3 text-xs leading-relaxed text-black/50 dark:text-white/50" aria-live="polite">
				{fromSources === null
					? choice === "openalex"
						? "OpenAlex has no answer for this record yet."
						: "Readers see your choice. OpenAlex has no answer for this record."
					: choice === "openalex"
						? `OpenAlex says it is ${accessName(fromSources)}.`
						: `Readers see your choice. OpenAlex says it is ${accessName(fromSources)}.`}
			</p>
		</section>
	);
}
