"use client";

import { Button } from "@/components/nextui/Button";
import type { SourceFieldConflict } from "@/lib/admin/source-field-contract";
import type { AdminItemDetail } from "@/lib/admin/types";

export type SourceResolution = {
	choice: "keep" | "source";
	sourceConnectionKey: string;
	fingerprint: string;
};

function sourceValueLabel(
	field: SourceFieldConflict,
	value: unknown,
	importedTopics: AdminItemDetail["importedTopics"],
) {
	if (field.field === "topics" && Array.isArray(value)) {
		const scores = new Map(
			importedTopics.map((topic) => [topic.topicId, topic]),
		);
		return value
			.filter((topicId): topicId is string => typeof topicId === "string")
			.map((topicId) => {
				const topic = scores.get(topicId);
				return topic
					? `${topicId} (OpenAlex score ${topic.score.toFixed(2)}${topic.primary ? ", primary" : ""})`
					: topicId;
			})
			.join(", ");
	}
	if (Array.isArray(value)) return value.join(", ");
	if (value === null || value === undefined || value === "") return "Empty";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

export function SourceConflictEditor({
	fields,
	importedTopics,
	onChange,
	readOnly,
	resolutions,
}: {
	fields: SourceFieldConflict[];
	importedTopics: AdminItemDetail["importedTopics"];
	onChange: (resolutions: Record<string, SourceResolution>) => void;
	readOnly: boolean;
	resolutions: Record<string, SourceResolution>;
}) {
	const conflicts = fields.filter((field) => field.conflicting);
	if (!conflicts.length) return null;

	return (
		<div className="space-y-3">
			<p className="text-sm text-black/55 dark:text-white/55">
				The source changed after this record was edited. Choose which value to
				publish.
			</p>
			{conflicts.map((field) => {
				const selected = resolutions[field.field]?.choice;
				const choose = (choice: SourceResolution["choice"]) =>
					onChange({
						...resolutions,
						[field.field]: {
							choice,
							fingerprint: field.fingerprint,
							sourceConnectionKey: field.sourceConnectionKey,
						},
					});
				return (
					<div
						key={`${field.field}:${field.sourceConnectionKey}`}
						className="rounded-xl border border-black/10 p-3 dark:border-white/10"
					>
						<p className="font-medium capitalize">{field.field}</p>
						<div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
							<div className="rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]">
								<p className="text-xs font-medium text-black/45 dark:text-white/45">
									Current value
								</p>
								<p className="mt-1 break-words">
									{sourceValueLabel(field, field.value, importedTopics)}
								</p>
							</div>
							<div className="rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]">
								<p className="text-xs font-medium text-black/45 dark:text-white/45">
									Source value
								</p>
								<p className="mt-1 break-words">
									{sourceValueLabel(
										field,
										field.sourceValue,
										importedTopics,
									)}
								</p>
							</div>
						</div>
						<div className="mt-3 flex gap-2">
							<Button
								aria-pressed={selected === "keep"}
								color={selected === "keep" ? "primary" : "default"}
								isDisabled={readOnly}
								onPress={() => choose("keep")}
								size="xs"
								variant={selected === "keep" ? "solid" : "muted"}
							>
								Keep current
							</Button>
							<Button
								aria-pressed={selected === "source"}
								color={selected === "source" ? "primary" : "default"}
								isDisabled={readOnly}
								onPress={() => choose("source")}
								size="xs"
								variant={selected === "source" ? "solid" : "muted"}
							>
								Use source
							</Button>
						</div>
					</div>
				);
			})}
		</div>
	);
}
