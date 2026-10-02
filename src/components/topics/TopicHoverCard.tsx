"use client";

import { useId, useRef, useState } from "react";
import useSWR from "swr";
import { FreeSoloPopover, Spinner } from "@nextui-org/react";
import { HOVER_CARD_CLOSE_DELAY, HOVER_CARD_DELAY, Tooltip } from "@/components/nextui/Tooltip";
import { AnimatePresence, useReducedMotion } from "framer-motion";
import { ArrowUpRight01Icon, TagsIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Card } from "@/components/nextui/Card";
import { HierarchyTree } from "@/components/typography/HierarchyTree";
import type { TopicTreeNode } from "@/lib/topics/contract";
import { fetchTopicDetail } from "@/lib/topics/client";

/** Keywords shown before the rest are left to the topic page. */
const VISIBLE_KEYWORDS = 6;

function openScholarUrl(base: string, path: string) {
	return new URL(path, base).toString();
}

/** Opens OpenScholar's topic directory filtered to a domain, field or subfield. */
function directoryUrl(base: string, id: string) {
	// "subfields/3312" filters with ?subfield=subfields/3312.
	const level = id.slice(0, id.indexOf("s/"));
	return openScholarUrl(base, `/topics?${new URLSearchParams({ [level]: id })}`);
}

export function TopicHoverCard({
	publicBaseUrl,
	topic,
}: {
	publicBaseUrl: string;
	topic: Pick<TopicTreeNode, "id" | "name">;
}) {
	const [open, setOpen] = useState(false);
	const [interactive, setInteractive] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null!);
	const dialogId = useId();
	const reducedMotion = useReducedMotion();
	// Warm these small descriptions with the visible chips, as author previews do.
	const detail = useSWR(
		["topic-detail", topic.id],
		() => fetchTopicDetail(topic.id),
		{ revalidateOnFocus: false, errorRetryCount: 1 },
	);

	const content = (
		<div className="flex max-h-[inherit] w-full min-h-0 flex-col">
			<div className="min-h-0 max-h-[min(480px,65vh)] space-y-3 overflow-y-auto p-4">
				<div className="flex items-start gap-2.5">
					<HugeiconsIcon
						icon={TagsIcon}
						size={18}
						className="mt-0.5 shrink-0 text-accent"
						aria-hidden
					/>
					<div className="min-w-0">
						<h3 className="text-base font-semibold leading-snug">
							{detail.data?.name ?? topic.name}
						</h3>
						{detail.data && (
							<p className="mt-0.5 text-xs text-black/50 dark:text-white/50">
								{detail.data.worksCount.toLocaleString()} publications
								in OpenAlex
							</p>
						)}
					</div>
				</div>
				{detail.data ? (
					<>
						<p
							className="line-clamp-3 text-sm leading-relaxed text-black/65 dark:text-white/65"
						>
							{detail.data.description}
						</p>
						<HierarchyTree
							label="Topic path"
							levels={[
								...detail.data.path.map((node, index) => ({
									...node,
									key: node.id,
									href: directoryUrl(publicBaseUrl, node.id),
									title: ["Domain", "Field", "Subfield"][index],
								})),
								{
									key: topic.id,
									name: detail.data.name,
									href: openScholarUrl(
										publicBaseUrl,
										`/topics/${encodeURIComponent(topic.id)}`,
									),
									title: "Topic",
								},
							]}
							renderLink={(level, _index, className) => (
								<a
									href={level.href}
									target="_blank"
									rel="noopener noreferrer"
									className={`${className} rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus`}
								>
									{level.name}
								</a>
							)}
						/>
						{detail.data.keywords.length > 0 && (
							<div
								className="flex flex-wrap gap-1"
								aria-label="Keywords"
							>
								{detail.data.keywords.slice(0, VISIBLE_KEYWORDS).map((keyword) => (
									<a
										key={keyword}
										href={openScholarUrl(
											publicBaseUrl,
											`/results?${new URLSearchParams({ q: keyword })}`,
										)}
										target="_blank"
										rel="noopener noreferrer"
										className="rounded-md bg-black/5 px-1.5 py-0.5 text-xs text-black/60 transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:bg-white/5 dark:text-white/60 dark:hover:bg-accent/10 dark:hover:text-accent"
									>
										{keyword}
									</a>
								))}
								{detail.data.keywords.length > VISIBLE_KEYWORDS && (
									<a
										href={openScholarUrl(
											publicBaseUrl,
											`/topics/${encodeURIComponent(topic.id)}`,
										)}
										target="_blank"
										rel="noopener noreferrer"
										className="rounded-md px-1.5 py-0.5 text-xs text-black/50 transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:text-white/50"
									>
										+{detail.data.keywords.length - VISIBLE_KEYWORDS} more
									</a>
								)}
							</div>
						)}
					</>
				) : detail.error ? (
					<div
						role="status"
						className="space-y-2 text-sm text-black/60 dark:text-white/60"
					>
						<p>Could not load topic details from OpenScholar.</p>
						<Button
							size="xs"
							variant="transparent"
							onPress={() => void detail.mutate()}
						>
							Try again
						</Button>
					</div>
				) : (
					<div className="flex min-h-24 items-center justify-center">
						<Spinner size="sm" aria-label="Loading topic details" />
					</div>
				)}
			</div>
			<div className="shrink-0 border-t border-black/[0.07] bg-black/[0.025] p-1.5 dark:border-white/[0.07] dark:bg-white/[0.025]">
				<Button
					as="a"
					role="link"
					href={openScholarUrl(
						publicBaseUrl,
						`/topics/${encodeURIComponent(topic.id)}`,
					)}
					target="_blank"
					rel="noopener noreferrer"
					size="sm"
					variant="transparent"
					className="w-full justify-between px-2.5 text-sm font-medium"
					endContent={
						<HugeiconsIcon
							icon={ArrowUpRight01Icon}
							size={16}
							aria-hidden
						/>
					}
				>
					View topic in OpenScholar
				</Button>
			</div>
		</div>
	);
	const cardClassName =
		"w-[400px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-black/10 bg-card_light p-0 text-black shadow-xl dark:border-white/10 dark:bg-card dark:text-white";

	return (
		<>
			<Tooltip
				color="default"
				isOpen={open && !interactive}
				isDisabled={interactive}
				onOpenChange={setOpen}
				delay={HOVER_CARD_DELAY}
				closeDelay={HOVER_CARD_CLOSE_DELAY}
				placement="top-start"
				offset={10}
				disableAnimation={Boolean(reducedMotion)}
				className={cardClassName}
				content={content}
			>
				<button
					ref={triggerRef}
					type="button"
					aria-haspopup="dialog"
					aria-expanded={interactive}
					aria-controls={interactive ? dialogId : undefined}
					onClick={() => {
						setOpen(false);
						setInteractive((value) => !value);
					}}
					className="block max-w-full rounded-2xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
				>
					<Card
						as="span"
						className="px-3 py-1 transition-colors hover:text-accent"
						color="card"
					>
						{topic.name}
					</Card>
				</button>
			</Tooltip>
			<AnimatePresence>
				{interactive && (
					<FreeSoloPopover
						id={dialogId}
						aria-label={topic.name}
						triggerRef={triggerRef}
						isOpen={interactive}
						onOpenChange={setInteractive}
						placement="top-start"
						offset={10}
						shouldBlockScroll={false}
						shouldCloseOnScroll={false}
						disableAnimation={Boolean(reducedMotion)}
						classNames={{
							base: "max-h-[inherit]",
							content: `${cardClassName} max-h-[inherit]`,
						}}
					>
						{content}
					</FreeSoloPopover>
				)}
			</AnimatePresence>
		</>
	);
}
