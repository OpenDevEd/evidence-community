"use client";

import { useState } from "react";
import useSWR from "swr";
import { Add01Icon, TagsIcon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { fetchTopicCatalog } from "@/lib/topics/client";
import { InspectorListRemove, InspectorListRow } from "./InspectorListRow";
import { TopicPickerDialog } from "./TopicPickerDialog";

export function TopicsEditor({
	importedTopics = [],
	readOnly,
	topics,
	onChange,
}: {
	importedTopics?: readonly {
		topicId: string;
		score: number;
		primary: boolean;
	}[];
	readOnly: boolean;
	topics: readonly string[];
	onChange: (topics: string[]) => void;
}) {
	const [picking, setPicking] = useState(false);
	const ids = [...new Set(topics)].sort();
	const importedIds = [
		...new Set(importedTopics.map((topic) => topic.topicId)),
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
				<p className="text-xs text-black/45 dark:text-white/45">
					Loading topics...
				</p>
			) : (
				<p className="text-xs leading-relaxed text-black/45 dark:text-white/45">
					No topics yet.
				</p>
			)}
			{importedTopics.length ? (
				<div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
					<p className="text-xs font-medium text-black/55 dark:text-white/55">
						Imported from OpenAlex
					</p>
					<ul className="mt-2 space-y-2">
						{importedTopics.map((imported) => {
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
											{imported.primary
												? " · Primary"
												: ""}
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
						onChange(chosen.map((topic) => topic.id));
						setPicking(false);
					}}
				/>
			) : null}
		</div>
	);
}
