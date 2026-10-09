"use client";

import { useState } from "react";
import useSWR from "swr";
import { Add01Icon, Loading03Icon, TagsIcon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { fetchTopicCatalog } from "@/lib/topics/client";
import { InspectorListRemove, InspectorListRow } from "./InspectorListRow";
import { TopicPickerDialog } from "./TopicPickerDialog";
import type { TopicNode } from "@/lib/topics/contract";

type ImportedTopic = {
	topicId: string;
	score: number;
	primary: boolean;
};

export function deduplicateImportedTopics(topics: readonly ImportedTopic[]) {
	const byId = new Map<string, ImportedTopic>();
	for (const topic of topics) {
		const previous = byId.get(topic.topicId);
		byId.set(
			topic.topicId,
			previous
				? {
						topicId: topic.topicId,
						score: Math.max(previous.score, topic.score),
						primary: previous.primary || topic.primary,
					}
				: topic,
		);
	}
	return [...byId.values()].sort(
		(left, right) =>
			Number(right.primary) - Number(left.primary) ||
			right.score - left.score ||
			left.topicId.localeCompare(right.topicId),
	);
}

export function mergeTopicPickerSelection(
	savedIds: readonly string[],
	resolved: readonly TopicNode[],
	chosen: readonly TopicNode[],
) {
	const resolvedIds = new Set(resolved.map((topic) => topic.id));
	return [
		...new Set([
			...savedIds.filter((id) => !resolvedIds.has(id)),
			...chosen.map((topic) => topic.id),
		]),
	].sort();
}

export function TopicsEditor({
	importedTopics = [],
	readOnly,
	topics,
	onChange,
}: {
	importedTopics?: readonly ImportedTopic[];
	readOnly: boolean;
	topics: readonly string[];
	onChange: (topics: string[]) => void;
}) {
	const [picking, setPicking] = useState(false);
	const ids = [...new Set(topics)].sort();
	const displayedImportedTopics = deduplicateImportedTopics(importedTopics);
	const importedIds = [
		...new Set(displayedImportedTopics.map((topic) => topic.topicId)),
	];
	const catalogIds = [...new Set([...ids, ...importedIds])];
	const catalog = useSWR(
		catalogIds.length ? ["admin-topics", catalogIds.join(",")] : null,
		() => fetchTopicCatalog({ ids: catalogIds }),
		{ revalidateOnFocus: false },
	);
	const nodes = catalog.data?.nodes ?? [];
	const selectedNodes = nodes.filter((node) => ids.includes(node.id));
	const nodesById = new Map(nodes.map((node) => [node.id, node]));

	return (
		<div className="space-y-2.5">
			{selectedNodes.length ? (
				<ul className="space-y-1.5">
					{selectedNodes.map((topic) => (
						<InspectorListRow
							key={topic.id}
							icon={TagsIcon}
							title={topic.name}
							description={topic.path.slice(0, -1).join(" > ")}
							actions={
								readOnly ? undefined : (
									<InspectorListRemove
										label={`Remove ${topic.name}`}
										onRemove={() =>
											onChange(
												ids.filter(
													(id) => id !== topic.id,
												),
											)
										}
									/>
								)
							}
						/>
					))}
				</ul>
			) : catalog.error ? (
				<div
					role="status"
					className="flex items-center gap-2 text-xs text-black/55 dark:text-white/55"
				>
					<span>Could not load topics.</span>
					<Button
						size="xs"
						variant="transparent"
						onPress={() => void catalog.mutate()}
					>
						Try again
					</Button>
				</div>
			) : ids.length ? (
				<span aria-label="Loading topics" className="flex h-4 items-center text-black/45 dark:text-white/45" role="status">
					<HugeiconsIcon icon={Loading03Icon} aria-hidden className="animate-spin motion-reduce:animate-none" size={14} />
				</span>
			) : (
				<p className="text-xs leading-relaxed text-black/45 dark:text-white/45">
					No topics yet.
				</p>
			)}
			{displayedImportedTopics.length ? (
				<div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
					<p className="text-xs font-medium text-black/55 dark:text-white/55">
						Imported from OpenAlex
					</p>
					<ul className="mt-2 space-y-2">
						{displayedImportedTopics.map((imported) => {
							const node = nodesById.get(imported.topicId);
							const selected = ids.includes(imported.topicId);
							return (
								<li
									key={imported.topicId}
									className="flex items-center gap-3 text-xs"
								>
									<span className="min-w-0 flex-1">
										<span className="block truncate font-medium text-black/75 dark:text-white/75">
											{node?.name ?? imported.topicId}
										</span>
										<span className="text-black/45 dark:text-white/45">
											OpenAlex score{" "}
											{imported.score.toFixed(2)}
											{imported.primary ? <span className="ml-2 font-medium">Primary</span> : null}
										</span>
									</span>
									{!readOnly && !selected ? (
										<Button
											size="xs"
											variant="transparent"
											onPress={() =>
												onChange([
													...ids,
													imported.topicId,
												])
											}
										>
											Add
										</Button>
									) : null}
								</li>
							);
						})}
					</ul>
				</div>
			) : null}
			{!readOnly ? (
				<Button
					size="sm"
					variant="transparent"
					className="h-8 gap-1.5 rounded-lg px-2 text-xs font-medium"
					onPress={() => setPicking(true)}
					startContent={
						<HugeiconsIcon icon={Add01Icon} aria-hidden size={14} />
					}
				>
					Add topics
				</Button>
			) : null}
			{picking ? (
				<TopicPickerDialog
					initial={selectedNodes}
					onClose={() => setPicking(false)}
					onConfirm={(chosen) => {
						onChange(
							mergeTopicPickerSelection(
								ids,
								selectedNodes,
								chosen,
							),
						);
						setPicking(false);
					}}
				/>
			) : null}
		</div>
	);
}
