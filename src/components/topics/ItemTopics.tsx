"use client";

import { Spinner } from "@nextui-org/react";

import { Button } from "@/components/nextui/Button";
import { useTopicTree } from "@/lib/topics/client";
import type { TopicTree } from "@/lib/topics/contract";
import { TopicHoverCard } from "./TopicHoverCard";
import { ItemPropertyRowWrapper } from "@/components/features/newlib/ItemPropertyRow";

export function ItemTopics({
	topicIds,
	topics,
}: {
	topicIds: readonly string[];
	topics: TopicTree | undefined;
}) {
	// The record brings its topic names. The list's copy of a record does not, so it uses the library's tree.
	const tree = useTopicTree({ enabled: !topics });
	const names = topics ?? tree.data;
	const ids = [...new Set(topicIds)].sort();

	if (!ids.length) return null;

	const byId = new Map(names?.nodes.map((node) => [node.id, node]));

	return (
		<section id="topics" aria-label="Topics" className="scroll-mt-24">
			<ItemPropertyRowWrapper title="Topics">
			{names ? (
				<div className="flex flex-wrap gap-2">
					{ids.flatMap((id) => {
						const topic = byId.get(id);
						return topic ? (
							<TopicHoverCard
								key={id}
								publicBaseUrl={names.publicBaseUrl}
								topic={topic}
							/>
						) : [];
					})}
				</div>
			) : tree.error ? (
				<div
					role="status"
					className="flex items-center gap-2 text-sm text-black/60 dark:text-white/60"
				>
					<span>Could not load topics.</span>
					<Button
						size="xs"
						variant="transparent"
						onPress={() => void tree.mutate()}
					>
						Try again
					</Button>
				</div>
			) : (
				<Spinner size="sm" aria-label="Loading topics" />
			)}
			</ItemPropertyRowWrapper>
		</section>
	);
}
