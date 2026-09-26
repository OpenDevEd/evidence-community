"use client";

import { useId, useRef, useState } from "react";
import useSWR from "swr";
import { FreeSoloPopover, Spinner } from "@nextui-org/react";
import { Tooltip } from "@/components/nextui/Tooltip";
import { AnimatePresence, useReducedMotion } from "framer-motion";
import {
	ArrowRight01Icon,
	ArrowUpRight01Icon,
	TagsIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Card } from "@/components/nextui/Card";
import type { TopicNode } from "@/lib/topics/contract";
import { fetchTopicDetail } from "@/lib/topics/client";

/** Keywords shown before the rest are left to the topic page. */
const VISIBLE_KEYWORDS = 6;

function openScholarUrl(base: string, path: string) {
	return new URL(path, base).toString();
}

function directoryUrl(base: string, id: string, name: string) {
	const key = id.startsWith("domains/")
		? "domain"
		: id.startsWith("fields/")
			? "field"
			: "q";
	const query = new URLSearchParams({ [key]: key === "q" ? name : id });
	return openScholarUrl(base, `/topics?${query}`);
}

export function TopicHoverCard({
	publicBaseUrl,
	topic,
}: {
	publicBaseUrl: string;
	topic: TopicNode;
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
							title={detail.data.description}
						>
							{detail.data.description}
						</p>
						{/* Domain › Field › Subfield, each opening its directory page. */}
						<nav
							aria-label="Topic path"
							className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs font-medium"
						>
							{detail.data.path.map((node, index) => (
								<span key={node.id} className="inline-flex items-center gap-1">
									{index > 0 && (
										<HugeiconsIcon
											icon={ArrowRight01Icon}
											size={12}
											className="text-black/35 dark:text-white/35"
											aria-hidden
										/>
									)}
									<a
										href={directoryUrl(
											publicBaseUrl,
											node.id,
											node.name,
										)}
										target="_blank"
										rel="noopener noreferrer"
										title={["Domain", "Field", "Subfield"][index]}
										className="rounded-sm hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
									>
										{node.name}
									</a>
								</span>
							))}
						</nav>
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
				delay={160}
				closeDelay={240}
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
