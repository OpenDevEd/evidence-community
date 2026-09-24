"use client";

import { useState } from "react";
import useSWRInfinite from "swr/infinite";
import {
	ModalContent,
	ModalFooter,
	ModalHeader,
	Spinner,
} from "@nextui-org/react";
import {
	ArrowRight01Icon,
	Cancel01Icon,
	Search01Icon,
	TagsIcon,
	Tick01Icon,
} from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import { Input } from "@/components/nextui/Input";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { InspectorListRemove } from "./InspectorListRow";
import {
	fetchAllTopicCatalogPages,
	fetchTopicCatalog,
} from "@/lib/topics/client";
import type { TopicNode } from "@/lib/topics/contract";

const LEVEL_NAMES = {
	domain: "Domain",
	field: "Field",
	subfield: "Subfield",
	topic: "Topic",
} as const;

function topicParentPath(topic: TopicNode) {
	return topic.path.slice(0, -1).join(" > ");
}

function TopicRow({
	topic,
	selected,
	showPath,
	onOpen,
	onToggle,
}: {
	topic: TopicNode;
	selected: boolean;
	showPath: boolean;
	onOpen: (topic: TopicNode) => void;
	onToggle: (topic: TopicNode) => void;
}) {
	const leaf = topic.level === "topic";
	return (
		<button
			type="button"
			aria-pressed={leaf ? selected : undefined}
			onClick={() => (leaf ? onToggle(topic) : onOpen(topic))}
			className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${selected ? "bg-accent/[0.085]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.035]"}`}
		>
			<span className="min-w-0 flex-1">
				<TruncatedText
					text={topic.name}
					className="text-sm font-medium text-black/80 dark:text-white/85"
				/>
				{(showPath || !leaf) && (
					<TruncatedText
						text={
							showPath
								? `${LEVEL_NAMES[topic.level]} in ${topicParentPath(topic)}`
								: `${topic.childCount} inside`
						}
						className="mt-0.5 text-xs text-black/45 dark:text-white/45"
					/>
				)}
			</span>
			{leaf ? (
				<span
					className={`grid size-5 shrink-0 place-items-center rounded-full ${selected ? "bg-accent text-white" : "border border-black/15 dark:border-white/15"}`}
				>
					{selected && (
						<HugeiconsIcon
							icon={Tick01Icon}
							size={13}
							aria-hidden
						/>
					)}
				</span>
			) : (
				<HugeiconsIcon
					icon={ArrowRight01Icon}
					aria-hidden
					className="shrink-0 text-black/30 dark:text-white/30"
					size={15}
				/>
			)}
		</button>
	);
}

export function TopicPickerDialog({
	initial,
	onClose,
	onConfirm,
}: {
	initial: readonly TopicNode[];
	onClose: () => void;
	onConfirm: (topics: TopicNode[]) => void;
}) {
	const [search, setSearch] = useState("");
	const [trail, setTrail] = useState<TopicNode[]>([]);
	const [chosen, setChosen] = useState<TopicNode[]>([...initial]);
	const query = search.trim();
	const parent = trail.at(-1) ?? null;
	const catalog = useSWRInfinite(
		(index, previous) => {
			if (index > 0 && (!query || !previous?.nextCursor)) return null;
			return [
				"topic-picker",
				query || null,
				query ? null : (parent?.id ?? null),
				index === 0 ? null : previous!.nextCursor,
			];
		},
		([, term, parentId, cursor]: [
			string,
			string | null,
			string | null,
			string | null,
		]) =>
			term
				? fetchTopicCatalog({ query: term, cursor })
				: fetchAllTopicCatalogPages({ parent: parentId }),
		{
			revalidateOnFocus: false,
			revalidateFirstPage: false,
			keepPreviousData: true,
		},
	);
	const results = [
		...new Map(
			(catalog.data?.flatMap((page) => page.nodes) ?? []).map((node) => [
				node.id,
				node,
			]),
		).values(),
	];
	const hasMore = Boolean(query && catalog.data?.at(-1)?.nextCursor);
	const loadingMore =
		catalog.isValidating && catalog.size > (catalog.data?.length ?? 0);
	const chosenIds = new Set(chosen.map((topic) => topic.id));

	function toggle(topic: TopicNode) {
		setChosen((current) =>
			current.some((entry) => entry.id === topic.id)
				? current.filter((entry) => entry.id !== topic.id)
				: [...current, topic],
		);
	}

	function open(topic: TopicNode) {
		// From a search result the trail is unknown, so start it at this level.
		setTrail(query ? [topic] : [...trail, topic]);
		setSearch("");
	}

	return (
		<DialogModal
			isOpen
			onOpenChange={(value) => {
				if (!value) onClose();
			}}
			size="3xl"
			scrollBehavior="inside"
			classNames={{
				base: "!max-w-[820px] overflow-hidden rounded-2xl",
				wrapper: "items-center",
			}}
		>
			<ModalContent className="flex max-h-[calc(100dvh-32px)] flex-col">
				<ModalHeader
					aria-label="Choose topics"
					className="flex shrink-0 items-start gap-3 px-5 pb-4 pt-5 font-normal sm:px-6"
				>
					<span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/[0.065] text-accent">
						<HugeiconsIcon icon={TagsIcon} aria-hidden size={22} />
					</span>
					<div className="min-w-0 flex-1">
						<h2 className="text-lg font-semibold">Choose topics</h2>
						<p className="mt-1 text-xs leading-relaxed text-black/50 dark:text-white/50">
							Topics come from the OpenAlex list of research
							areas, shared by every library.
						</p>
					</div>
					<Button
						isIconOnly
						aria-label="Close topic picker"
						variant="transparent"
						size="xs"
						onPress={onClose}
						className="size-8 shrink-0 rounded-lg text-black/50 dark:text-white/50"
					>
						<HugeiconsIcon icon={Cancel01Icon} size={18} />
					</Button>
				</ModalHeader>
				<div className="shrink-0 px-5 pb-4 sm:px-6">
					<Input
						color="filled"
						autoFocus
						aria-label="Search topics"
						maxLength={200}
						placeholder="Search 4,516 topics by name"
						value={search}
						onValueChange={setSearch}
						startContent={
							<HugeiconsIcon
								icon={Search01Icon}
								size={18}
								className="shrink-0 text-black/40 dark:text-white/40"
							/>
						}
						endContent={
							search ? (
								<button
									type="button"
									aria-label="Clear topic search"
									onClick={() => setSearch("")}
								>
									<HugeiconsIcon
										icon={Cancel01Icon}
										size={15}
									/>
								</button>
							) : null
						}
						classNames={{
							inputWrapper: "h-11 min-h-11 rounded-xl",
							input: "text-sm",
						}}
					/>
				</div>
				<div className="grid min-h-0 flex-1 border-y border-black/[0.07] dark:border-white/[0.07] sm:grid-cols-[minmax(0,1fr)_280px]">
					<div className="flex min-h-0 min-w-0 flex-col">
						<nav
							aria-label="Topic level"
							className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-black/[0.055] px-4 text-xs dark:border-white/[0.06]"
						>
							{query ? (
								<span className="text-black/50 dark:text-white/50">
									{catalog.isLoading
										? "Searching"
										: `${results.length} matches for “${query}”`}
								</span>
							) : (
								[null, ...trail].map((node, index) => {
									const last = index === trail.length;
									return (
										<span
											key={node?.id ?? "all"}
											className="flex items-center gap-1"
										>
											{index > 0 && (
												<HugeiconsIcon
													icon={ArrowRight01Icon}
													aria-hidden
													className="text-black/25 dark:text-white/25"
													size={12}
												/>
											)}
											<button
												type="button"
												aria-current={
													last
														? "location"
														: undefined
												}
												disabled={last}
												onClick={() =>
													setTrail(
														trail.slice(0, index),
													)
												}
												className={`rounded-md px-1.5 py-1 ${last ? "font-semibold text-black/80 dark:text-white/85" : "text-black/50 hover:bg-black/[0.05] hover:text-black/75 dark:text-white/50 dark:hover:bg-white/[0.06]"}`}
											>
												{node ? node.name : "All areas"}
											</button>
										</span>
									);
								})
							)}
						</nav>
						<div
							aria-label="Topics"
							className="h-[340px] min-h-40 overflow-y-auto overscroll-contain p-2 sm:h-[388px]"
						>
							{catalog.error && results.length === 0 ? (
								<div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
									<p className="text-sm font-medium">
										Could not load topics
									</p>
									<Button
										size="xs"
										variant="transparent"
										onPress={() => void catalog.mutate()}
									>
										Try again
									</Button>
								</div>
							) : catalog.isLoading && !catalog.data ? (
								<div className="flex h-full items-center justify-center">
									<Spinner
										size="sm"
										aria-label="Loading topics"
									/>
								</div>
							) : results.length === 0 ? (
								<div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
									<HugeiconsIcon
										icon={Search01Icon}
										size={28}
										className="text-black/30 dark:text-white/30"
									/>
									<p className="text-sm font-medium">
										No topics found
									</p>
									<p className="max-w-60 text-xs leading-relaxed text-black/50 dark:text-white/50">
										Try a broader word, or browse from All
										areas.
									</p>
								</div>
							) : (
								<>
									{results.map((topic) => (
										<TopicRow
											key={topic.id}
											topic={topic}
											selected={chosenIds.has(topic.id)}
											showPath={Boolean(query)}
											onOpen={open}
											onToggle={toggle}
										/>
									))}
									{query && (catalog.error || hasMore) ? (
										<div className="px-2 py-1">
											<Button
												size="xs"
												variant="transparent"
												className="h-8 w-full text-xs"
												isDisabled={loadingMore}
												onPress={() =>
													catalog.error
														? void catalog.mutate()
														: void catalog.setSize(
																catalog.size + 1,
															)
												}
											>
												{catalog.error
													? "Try again"
													: loadingMore
														? "Loading"
														: "Show more"}
											</Button>
										</div>
									) : null}
								</>
							)}
						</div>
					</div>
					<aside
						aria-label="Chosen topics"
						className="flex min-h-0 flex-col border-t border-black/[0.07] bg-black/[0.015] dark:border-white/[0.07] dark:bg-white/[0.02] sm:border-l sm:border-t-0"
					>
						<p className="flex h-10 shrink-0 items-center px-4 text-xs font-medium text-black/55 dark:text-white/55">
							Chosen for this record
						</p>
						{chosen.length === 0 ? (
							<p className="px-4 text-xs leading-relaxed text-black/45 dark:text-white/45">
								Nothing chosen yet. Open an area on the left and
								tick the topics that fit.
							</p>
						) : (
							<ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
								{chosen.map((topic) => (
									<li
										key={topic.id}
										className="flex items-center gap-1 rounded-xl bg-white py-1.5 pl-3 pr-1.5 dark:bg-white/[0.05]"
									>
										<span className="min-w-0 flex-1">
											<TruncatedText
												text={topic.name}
												className="text-[13px] font-medium leading-4"
											/>
											<TruncatedText
												text={topicParentPath(topic)}
												className="text-[11px] leading-4 text-black/45 dark:text-white/45"
											/>
										</span>
										<InspectorListRemove
											label={`Remove ${topic.name}`}
											onRemove={() => toggle(topic)}
										/>
									</li>
								))}
							</ul>
						)}
					</aside>
				</div>
				<ModalFooter className="flex shrink-0 items-center justify-between gap-3 px-5 py-4 sm:px-6">
					<span className="text-xs tabular-nums text-black/50 dark:text-white/50">
						{chosen.length === 1
							? "1 topic chosen"
							: `${chosen.length} topics chosen`}
					</span>
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							variant="transparent"
							className="h-9 rounded-xl text-xs"
							onPress={onClose}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							color="accent"
							className="h-9 rounded-xl text-xs font-medium"
							onPress={() => onConfirm(chosen)}
						>
							Use topics
						</Button>
					</div>
				</ModalFooter>
			</ModalContent>
		</DialogModal>
	);
}
