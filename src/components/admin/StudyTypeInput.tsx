"use client";

import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { STUDY_LEVELS, STUDY_TYPES, studyType, type StudyReading, type StudyTypeKey } from "@/lib/readings/study-types";

const FROM_READING = "reading";

/** What the reading found, in a sentence for the editor. */
function readingSays(reading: StudyReading | null) {
	if (!reading || reading.by === "editor") return "This record has not been read yet.";
	const label = studyType(reading.type)?.label ?? reading.type;
	return reading.by === "metadata"
		? `Its metadata says it is a ${label.toLowerCase()}.`
		: `Jev read it as a ${label.toLowerCase()}, ${Math.round(reading.confidence * 100)}% sure.`;
}

/** What kind of work a record is: what its reading found, or an editor's correction, which wins. */
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
				<Select
					isDisabled={disabled}
					aria-label="Study type"
					color="filled"
					size="sm"
					placement="left"
					className="max-w-none"
					selectedKeys={new Set([value ?? FROM_READING])}
					onSelectionChange={(keys) => {
						const key = [...keys][0];
						if (typeof key === "string") onChange(key === FROM_READING ? null : (key as StudyTypeKey));
					}}
					classNames={{ trigger: "h-9 min-h-9 rounded-xl bg-white shadow-none dark:bg-white/5", value: "text-sm font-medium" }}
				>
					{[
						<SelectItem key={FROM_READING}>From the reading</SelectItem>,
						...STUDY_TYPES.map((type) => (
							<SelectItem key={type.key} description={STUDY_LEVELS.find((level) => level.key === type.level)?.label}>
								{type.label}
							</SelectItem>
						)),
					]}
				</Select>
			</div>
			<p className="px-3.5 pb-3.5 pt-1 text-xs leading-relaxed text-black/50 dark:text-white/50" aria-live="polite">
				{value ? `Readers see your choice. ${readingSays(reading)}` : readingSays(reading)}
			</p>
		</section>
	);
}
