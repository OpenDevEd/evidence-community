"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { useContext, useLayoutEffect, useRef, useState } from "react";
import { twMerge } from "@/lib/tw-merge";
import { Button } from "../../nextui/Button";
import { motion } from "framer-motion";
import { AnimatePresence } from "framer-motion";
import { Collection } from "@/app/api/collections/types";
import { MAX_COLLAPSED_HEIGHT } from "@/constants/collections";
import CollectionHierarchy from "./CollectionHierarchy";
import type { FacetDistribution } from "@/lib/search-engine";
import { useTranslations } from "next-intl";
import { CacheContext } from "@/context/Providers";

/** Whether a section's list is opened past its collapsed height, kept for the visit so it stays open as the reader moves around. */
function useSeeMore(key: string) {
	const { globalExpanded, setGlobalExpanded } = useContext(CacheContext);
	const expanded: boolean = globalExpanded[key] ?? false;
	const setExpanded = (value: boolean) => setGlobalExpanded((current: Record<string, boolean>) => ({ ...current, [key]: value }));
	return [expanded, setExpanded] as const;
}

/**
 * Whether a list is taller than its collapsed height, and whether a change to that should fade. Measured before the
 * first paint, so a section opening shows its See more and fade at once rather than adding them after; only later
 * changes, such as a filter shortening the list, fade. The observer follows the list's height.
 */
function useListOverflow(ref: React.RefObject<HTMLDivElement | null>, key: string) {
	const [overflow, setOverflow] = useState({ shown: false, fade: false });
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		setOverflow({ shown: element.scrollHeight > MAX_COLLAPSED_HEIGHT, fade: false });
		const observer = new ResizeObserver(() => {
			const shown = element.scrollHeight > MAX_COLLAPSED_HEIGHT;
			setOverflow((current) => (current.shown === shown ? current : { shown, fade: true }));
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref, key]);
	return overflow;
}

export default function CollectionCategory({
	collection,
	hierarchy,
	selectedCollections,
	handleCheckboxChange,
	facetDistribution,
	total,
}: {
	collection: Collection;
	hierarchy: Collection[];
	selectedCollections: string[];
	handleCheckboxChange: (key: string) => void;
	facetDistribution: FacetDistribution | undefined;
	total?: number;
}) {
	const t = useTranslations("ui");
	const ref = useRef<HTMLDivElement>(null);
	const [expanded, setExpanded] = useSeeMore(collection.key);
	const overflow = useListOverflow(ref, collection.key);
	const hasOverflow = overflow.shown;

	return (
		<div className="relative">
			<div
				style={
					!expanded ? {
						maxHeight: MAX_COLLAPSED_HEIGHT,
					} : {}
				}
				className={twMerge(
					"flex flex-col gap-4 overflow-hidden transition-all duration-200 pb-0 py-2"
				)}
				ref={ref}
			>
				<CollectionHierarchy
					collectionData={collection}
					collections={hierarchy}
					selectedCollections={selectedCollections}
					onCheckboxChange={handleCheckboxChange}
					facetDistribution={facetDistribution}
					total={total}
				/>
			</div>
			{hasOverflow && (
					<div
						className={twMerge(
							"transition-all duration-200 pb-0",
							expanded && "pb-14"
						)}
				></div>
			)}
			<AnimatePresence mode="wait" initial={false}>
				{hasOverflow && (
					<motion.div
						initial={overflow.fade ? { opacity: 0 } : false}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						className={twMerge(
							"absolute bottom-0 w-full bg-card_light dark:bg-card z-10",
							"before:absolute before:-top-24 before:left-0 before:right-0 before:h-24 before:bg-gradient-to-t before:from-card_light dark:before:from-card before:to-transparent before:z-10 before:opacity-100 before:transition-opacity duration-400 before:pointer-events-none",
							expanded && "before:opacity-0"
						)}
						key={"show-more"}
					>
						<Button
							className="w-full"
							endContent={
								<HugeiconsIcon icon={ArrowDown01Icon}
									className={twMerge(
										expanded && "rotate-180"
									)}
								/>
							}
							onPress={() => setExpanded(!expanded)}
						>
							{expanded ? t("seeLess") : t("seeMore")}
						</Button>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
