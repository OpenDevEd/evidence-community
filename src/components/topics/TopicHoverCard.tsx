"use client";

import { useId, useRef, useState } from "react";
import useSWR from "swr";
import { FreeSoloPopover, Tooltip, Spinner } from "@nextui-org/react";
import { AnimatePresence, useReducedMotion } from "framer-motion";
import { ArrowUpRight01Icon, TagsIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Card } from "@/components/nextui/Card";
import type { TopicNode } from "@/lib/topics/contract";
import { fetchTopicDetail } from "@/lib/topics/client";

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
			<div className="min-h-0 max-h-[min(480px,65vh)] space-y-4 overflow-y-auto p-5">
				<div className="flex items-start gap-3">
					<HugeiconsIcon
						icon={TagsIcon}
						size={22}
						className="mt-0.5 shrink-0 text-accent"
						aria-hidden
					/>
					<h3 className="text-lg font-semibold leading-snug">
						{detail.data?.name ?? topic.name}
					</h3>
				</div>
				{detail.data ? (
					<>
						<p className="text-sm leading-relaxed text-black/65 dark:text-white/65">
							{detail.data.description}
						</p>
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
							{detail.data.path.map((node, index) => (
								<div key={node.id} className="contents">
									<dt className="text-black/45 dark:text-white/45">
										{["Domain", "Field", "Subfield"][index]}
									</dt>
									<dd className="font-medium">
										<a
											href={directoryUrl(
												publicBaseUrl,
												node.id,
												node.name,
											)}
											target="_blank"
											rel="noopener noreferrer"
											className="rounded-sm hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
										>
											{node.name}
										</a>
									</dd>
								</div>
							))}
						</dl>
						{detail.data.keywords.length > 0 && (
							<div
								className="flex flex-wrap gap-1.5"
								aria-label="Keywords"
							>
								{detail.data.keywords.map((keyword) => (
									<a
										key={keyword}
										href={openScholarUrl(
											publicBaseUrl,
											`/results?${new URLSearchParams({ q: keyword })}`,
										)}
										target="_blank"
										rel="noopener noreferrer"
										className="rounded-md bg-black/5 px-2 py-1 text-xs text-black/60 transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus dark:bg-white/5 dark:text-white/60 dark:hover:bg-accent/10 dark:hover:text-accent"
									>
										{keyword}
									</a>
								))}
							</div>
						)}
						<p className="text-xs text-black/50 dark:text-white/50">
							{detail.data.worksCount.toLocaleString()}{" "}
							publications in OpenAlex
						</p>
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
			<div className="shrink-0 border-t border-black/[0.07] bg-black/[0.025] p-3 dark:border-white/[0.07] dark:bg-white/[0.025]">
				<Button
					as="a"
					role="link"
					href={openScholarUrl(
						publicBaseUrl,
						`/topics/${encodeURIComponent(topic.id)}`,
					)}
					target="_blank"
					rel="noopener noreferrer"
					size="md"
					variant="transparent"
					className="w-full justify-between px-2 text-sm font-medium"
					endContent={
						<HugeiconsIcon
							icon={ArrowUpRight01Icon}
							size={18}
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
				isOpen={open && !interactive}
				isDisabled={interactive}
				onOpenChange={setOpen}
				delay={160}
				closeDelay={240}
				placement="top-start"
				offset={10}
				isDismissable
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
