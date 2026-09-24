"use client";

import useSWR from "swr";
import { Spinner } from "@nextui-org/react";

import { Button } from "@/components/nextui/Button";
import { fetchTopicCatalog } from "@/lib/topics/client";
import { TopicHoverCard } from "./TopicHoverCard";
import { ItemPropertyRowWrapper } from "@/components/features/newlib/ItemPropertyRow";

export function ItemTopics({ topicIds }: { topicIds: readonly string[] }) {
	const ids = [...new Set(topicIds)].sort();
	const topics = useSWR(
		ids.length ? ["item-topics", ids.join(",")] : null,
		() => fetchTopicCatalog({ ids }),
		{ revalidateOnFocus: false, errorRetryCount: 1 },
	);

	if (!ids.length) return null;

	return (
		<section id="topics" aria-label="Topics" className="scroll-mt-24">
			<ItemPropertyRowWrapper title="Topics">
			{topics.data ? (
				<div className="flex flex-wrap gap-2">
					{topics.data.nodes.map((topic) => (
						<TopicHoverCard
							key={topic.id}
							publicBaseUrl={topics.data!.publicBaseUrl}
							topic={topic}
						/>
					))}
				</div>
			) : topics.error ? (
				<div
					role="status"
					className="flex items-center gap-2 text-sm text-black/60 dark:text-white/60"
				>
					<span>Could not load topics.</span>
					<Button
						size="xs"
						variant="transparent"
						onPress={() => void topics.mutate()}
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
