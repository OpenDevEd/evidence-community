"use client";

import { AutocompleteItem } from "@nextui-org/react";

import { Autocomplete } from "@/components/nextui/Autocomplete";
import { inspectorInputClassNames } from "@/components/nextui/field-styles";
import { STUDY_LEVELS, STUDY_TYPES, studyType, type StudyReading, type StudyTypeKey } from "@/lib/readings/study-types";

const FROM_READING = "reading";

/** What the reading found, in a sentence for the editor. */
function readingSays(reading: StudyReading | null) {
	if (!reading || reading.by === "editor") return "This record has not been read yet.";
	const label = studyType(reading.type)?.label ?? reading.type;
	return reading.by === "metadata"
		? `Its metadata says “${label}”.`
		: `Read by AI as “${label}”, ${Math.round(reading.confidence * 100)}% sure.`;
}

const levelOf = (level: string) => STUDY_LEVELS.find(({ key }) => key === level)?.label;

/**
 * What kind of work a record is: what its reading found, or an editor's
 * correction, which wins. The same searchable field as the record's Item type.
 */
export function StudyTypeInput({
	value,
	reading,
	onChange,
	disabled = false,
}: {
	value: StudyTypeKey | null;
	/** What the reading found, whatever the editor chose; null before the record is read. */
	reading: StudyReading | null;
	onChange: (value: StudyTypeKey | null) => void;
	disabled?: boolean;
}) {
	return (
		<section
			aria-label="Study type"
			className="overflow-hidden rounded-2xl border border-black/[0.07] bg-black/[0.025] dark:border-white/[0.07] dark:bg-white/[0.025]"
		>
			<div className="p-2">
				<Autocomplete
					aria-label="Study type"
					allowsCustomValue={false}
					className="max-w-none"
					classNames={{ listboxWrapper: "max-h-80" }}
					inputProps={{ classNames: inspectorInputClassNames }}
					isClearable={false}
					isDisabled={disabled}
					menuTrigger="focus"
					placeholder="Find a study type"
					selectedKey={value ?? FROM_READING}
					onSelectionChange={(key) => {
						if (typeof key === "string") onChange(key === FROM_READING ? null : (key as StudyTypeKey));
					}}
				>
					{[
						<AutocompleteItem key={FROM_READING} textValue="From the reading">
							From the reading
						</AutocompleteItem>,
						...STUDY_TYPES.map((type) => (
							<AutocompleteItem key={type.key} description={levelOf(type.level)} textValue={type.label}>
								{type.label}
							</AutocompleteItem>
						)),
					]}
				</Autocomplete>
			</div>
			<p className="px-3.5 pb-3.5 pt-1 text-xs leading-relaxed text-black/50 dark:text-white/50" aria-live="polite">
				{value ? `Readers see your choice. ${readingSays(reading)}` : readingSays(reading)}
			</p>
		</section>
	);
}
