"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { CompassIcon } from "@hugeicons/core-free-icons";

import { type ComponentProps, type ReactNode, use, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { motion, useReducedMotion } from "framer-motion";
import { useFormatter, useTranslations } from "next-intl";
import { useDisclosure } from "@nextui-org/react";
import { twMerge } from "@/lib/tw-merge";
import { Button } from "@/components/nextui/Button";
import { Card } from "@/components/nextui/Card";
import { Switch } from "@/components/nextui/Switch";
import { Tooltip } from "@/components/nextui/Tooltip";
import { ScopeComponent, SortComponent } from "./LibrarySearchSelects";
import { useInlineChatLayout } from "@/context/InlineChatLayout";
import { bucketEntriesFromMessages } from "@/lib/ai/context-bucket";
import { BucketList, useBucketPublications } from "../ai/ContextBucket";
import ExploreModal from "../collections/ExploreModal";
import { ItemsContext } from "@/context/ItemsContext";
import { SearchBar } from "../SearchBar";

export type EngagedLibraryView = "results" | "sources";

function nextEngagedTab(
	key: string,
	view: EngagedLibraryView,
): EngagedLibraryView {
	if (key === "Home") return "results";
	if (key === "End") return "sources";
	return view === "results" ? "sources" : "results";
}

type EngagedSegment = { key: EngagedLibraryView; label: string; count: number };

function EngagedLibraryTabs({
	idPrefix,
	segments,
	view,
	setView,
}: {
	idPrefix: string;
	segments: EngagedSegment[];
	view: EngagedLibraryView;
	setView: (view: EngagedLibraryView) => void;
}) {
	const t = useTranslations("ui");
	const formatter = useFormatter();
	const reducedMotion = useReducedMotion();
	return (
		<div
			role="tablist"
			aria-label={t("searchTitle")}
			className="inline-flex w-fit shrink-0 items-center gap-1 rounded-2xl bg-black/[0.04] p-1 dark:bg-white/[0.06]"
		>
			{segments.map((segment) => (
				<button
					key={segment.key}
					type="button"
					role="tab"
					id={`${idPrefix}-tab-${segment.key}`}
					aria-controls={`${idPrefix}-${segment.key}`}
					aria-selected={view === segment.key}
					tabIndex={view === segment.key ? 0 : -1}
					onKeyDown={(event) => {
						if (
							![
								"ArrowLeft",
								"ArrowRight",
								"Home",
								"End",
							].includes(event.key)
						)
							return;
						event.preventDefault();
						const next = nextEngagedTab(event.key, view);
						setView(next);
						const buttons =
							event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
								'[role="tab"]',
							);
						buttons?.[next === "results" ? 0 : 1]?.focus();
					}}
					onClick={() => setView(segment.key)}
					className={twMerge(
						"relative h-9 rounded-xl px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus",
						view === segment.key
							? "text-black dark:text-white"
							: "text-black/50 hover:text-black/80 dark:text-white/50 dark:hover:text-white/80",
					)}
				>
					{view === segment.key && (
						<motion.span
							layoutId="engaged-library-segment"
							transition={{
								type: "spring",
								bounce: 0.2,
								duration: reducedMotion ? 0 : 0.5,
							}}
							className="absolute inset-0 rounded-xl bg-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:bg-white/10 dark:shadow-none"
						/>
					)}
					<span className="relative flex items-center gap-1.5">
						{segment.label}
						<motion.span
							key={segment.count}
							initial={
								reducedMotion
									? false
									: {
											scale:
												segment.key === "sources"
													? 1.35
													: 1,
										}
							}
							animate={{ scale: 1 }}
							transition={{
								type: "spring",
								bounce: 0.5,
								duration: reducedMotion ? 0 : 0.45,
							}}
							className="text-xs tabular-nums text-black/40 dark:text-white/40"
						>
							{formatter.number(segment.count)}
						</motion.span>
					</span>
				</button>
			))}
		</div>
	);
}

function EngagedSources({
	entries,
	publications,
}: ComponentProps<typeof BucketList>) {
	const tAI = useTranslations("ai");
	return entries.length > 0 ? (
		<BucketList entries={entries} publications={publications} />
	) : (
		<p className="rounded-2xl border border-dashed border-black/10 p-10 text-center text-sm text-black/40 dark:border-white/10 dark:text-white/40">
			{tAI("sourcesEmpty")}
		</p>
	);
}

export function EngagedLibraryPanel({
	idPrefix,
	modelId,
	extraFilters,
	filterChips,
	view,
	setView,
	abstract,
	setAbstract,
}: {
	idPrefix: string;
	modelId: string;
	extraFilters: ReactNode;
	filterChips: ReactNode;
	view: EngagedLibraryView;
	setView: (view: EngagedLibraryView) => void;
	abstract: boolean;
	setAbstract: (abstract: boolean) => void;
}) {
	const t = useTranslations("ui");
	const tAI = useTranslations("ai");
	const itemsContext = use(ItemsContext);
	const { getInlineChat } = useInlineChatLayout();
	const [chat] = useState(() =>
		getInlineChat(modelId, tAI("askMeAnythingPublications")),
	);
	const { messages } = useChat({ chat, throttle: 50 });
	const bucketEntries = bucketEntriesFromMessages(messages);
	const publications = useBucketPublications(bucketEntries);

	const {
		isOpen: isExploreOpen,
		onOpen: onExploreOpen,
		onOpenChange: onExploreOpenChange,
	} = useDisclosure();
	const totalItems = itemsContext.itemsData?.totalItems ?? 0;

	const segments: EngagedSegment[] = [
		{ key: "results", label: t("resultsLabel"), count: totalItems },
		{
			key: "sources",
			label: tAI("sourcesTitle"),
			count: bucketEntries.length,
		},
	];

	return (
		<div className="flex w-full min-w-0 flex-col gap-4">
			<div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<EngagedLibraryTabs
					idPrefix={idPrefix}
					segments={segments}
					view={view}
					setView={setView}
				/>
				{view === "results" && (
					<div className="flex min-w-0 shrink-0 items-stretch gap-3 animate-in fade-in duration-200 max-lg:[&>*]:flex-1">
						<Card className="flex h-11 min-w-0 items-center justify-center px-3">
							<Switch
								size="sm"
								isSelected={abstract}
								onValueChange={setAbstract}
								classNames={{ base: "flex-row-reverse" }}
							>
								{t("abstract")}
							</Switch>
						</Card>

						<Tooltip content={t("explore")}>
							<Button
								startContent={
									<HugeiconsIcon icon={CompassIcon} className="size-5 shrink-0" />
								}
								aria-label={t("explore")}
								className="h-11 min-w-11 shrink-0 lg:px-0 lg:@[34rem]:px-4"
								onPress={onExploreOpen}
							>
								<span className="lg:hidden lg:@[34rem]:inline">
									{t("explore")}
								</span>
							</Button>
						</Tooltip>
						<ExploreModal
							variant="sheet"
							isOpen={isExploreOpen}
							onOpenChange={onExploreOpenChange}
						/>
					</div>
				)}
			</div>

			{view === "results" ? (
				<div
					key="results-view"
					className="flex w-full min-w-0 flex-col gap-4 animate-in fade-in slide-in-from-left-2 rtl:slide-in-from-right-2 duration-200 ease-out motion-reduce:animate-none"
				>
					<SearchBar
						handleSearchChange={itemsContext.handleSearchChange}
						onTyped={itemsContext.noteTypedSearch}
						search={itemsContext.queryParams.search}
					/>

					<div className="flex min-w-0 flex-nowrap items-stretch gap-3">
						<div className="flex min-w-0 basis-3/5 [&>[data-slot=base]]:!max-w-none">
							<ScopeComponent itemsContext={itemsContext} />
						</div>
						<div className="flex min-w-0 basis-2/5 [&>[data-slot=base]]:!max-w-none">
							<SortComponent itemsContext={itemsContext} />
						</div>
						{extraFilters}
					</div>
					{filterChips}
				</div>
			) : (
				<div
					key="sources-view"
					role="tabpanel"
					id={`${idPrefix}-sources`}
					aria-labelledby={`${idPrefix}-tab-sources`}
					tabIndex={0}
					className="flex w-full min-w-0 flex-col gap-4 animate-in fade-in slide-in-from-right-2 rtl:slide-in-from-left-2 duration-200 ease-out motion-reduce:animate-none"
				>
					<EngagedSources
						entries={bucketEntries}
						publications={publications}
					/>
				</div>
			)}
		</div>
	);
}
