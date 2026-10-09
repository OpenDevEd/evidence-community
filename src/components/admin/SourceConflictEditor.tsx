"use client";

import { Button } from "@/components/nextui/Button";
import { ConflictValue } from "./DraftConflict";
import { adminFieldLabel } from "@/lib/admin/errors";
import type { SourceFieldConflict } from "@/lib/admin/source-field-contract";
import type { AdminItemDetail } from "@/lib/admin/types";
import { fetchTopicCatalog } from "@/lib/topics/client";
import { deduplicateImportedTopics } from "./TopicsEditor";
import useSWR from "swr";

export type SourceResolution = {
	choice: "keep" | "source";
	sourceConnectionKey: string;
	fingerprint: string;
};

function topicIds(value: unknown) {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

function TopicConflictValue({
	value,
importedTopics,
	names,
}: {
	value: unknown;
	importedTopics: AdminItemDetail["importedTopics"];
	names: ReadonlyMap<string, string>;
}) {
	const ids = topicIds(value);
	if (!ids.length) return <ConflictValue field="topics" value={value} />;
	const scores = new Map(
		deduplicateImportedTopics(importedTopics).map((topic) => [
			topic.topicId,
			topic,
		]),
	);
	return (
		<span className="flex flex-col gap-1">
			{ids.map((topicId) => {
				const topic = scores.get(topicId);
				return (
					<span key={topicId}>
						{names.get(topicId) ?? topicId}
						{topic ? (
							<span className="ml-2 text-black/45 dark:text-white/45">
								OpenAlex score {topic.score.toFixed(2)}
								{topic.primary ? <span className="ml-2 font-medium">Primary</span> : null}
							</span>
						) : null}
					</span>
				);
			})}
		</span>
	);
}

function SourceConflictValue({
	field,
	value,
	importedTopics,
	topicNames,
}: {
	field: string;
	value: unknown;
	importedTopics: AdminItemDetail["importedTopics"];
	topicNames: ReadonlyMap<string, string>;
}) {
	return field === "topics" ? (
		<TopicConflictValue
			value={value}
			importedTopics={importedTopics}
			names={topicNames}
		/>
	) : (
		<ConflictValue field={field} value={value} />
	);
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
	const conflictTopicIds = [
		...new Set(
			conflicts
				.filter((field) => field.field === "topics")
				.flatMap((field) => [
					...topicIds(field.value),
					...topicIds(field.sourceValue),
				]),
		),
	].sort();
	const topics = useSWR(
		conflictTopicIds.length
			? ["source-conflict-topics", conflictTopicIds.join(",")]
			: null,
		() => fetchTopicCatalog({ ids: conflictTopicIds }),
		{ revalidateOnFocus: false },
	);
	const topicNames = new Map(
		topics.data?.nodes.map((topic) => [topic.id, topic.name]),
	);
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
						<p className="font-medium">{adminFieldLabel(field.field)}</p>
						<div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
							<div className="rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]">
								<p className="text-xs font-medium text-black/45 dark:text-white/45">
									Current value
								</p>
								<div className="mt-1 break-words">
									<SourceConflictValue
										field={field.field}
										value={field.value}
										importedTopics={importedTopics}
										topicNames={topicNames}
									/>
								</div>
							</div>
							<div className="rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]">
								<p className="text-xs font-medium text-black/45 dark:text-white/45">
									Source value
								</p>
								<div className="mt-1 break-words">
									<SourceConflictValue
										field={field.field}
										value={field.sourceValue}
										importedTopics={importedTopics}
										topicNames={topicNames}
									/>
								</div>
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
