"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { useContext, useEffect, useRef, useState } from "react";
import { twMerge } from "@/lib/tw-merge";
import { Button } from "../../nextui/Button";
import { motion } from "framer-motion";
import { AnimatePresence } from "framer-motion";
import { Collection } from "@/app/api/collections/types";
import { MAX_COLLAPSED_HEIGHT } from "@/constants/collections";
import CollectionHierarchy from "./CollectionHierarchy";
import { FacetDistribution } from "meilisearch";
import { useTranslations } from "next-intl";
import { CacheContext } from "@/context/Providers";

export default function CollectionCategory({
	collection,
	hierarchy,
	selectedCollections,
	handleCheckboxChange,
	facetDistribution,
}: {
	collection: Collection;
	hierarchy: Collection[];
	selectedCollections: string[];
	handleCheckboxChange: (key: string) => void;
	facetDistribution: FacetDistribution | undefined;
}) {
	const t = useTranslations("ui");
	const ref = useRef<HTMLDivElement>(null);
	const { globalExpanded, setGlobalExpanded } = useContext(CacheContext);
	const expanded = globalExpanded[collection.key] ?? false;
	const setExpanded = (value: boolean | ((previous: boolean) => boolean)) => {
		setGlobalExpanded((current: Record<string, boolean>) => {
			const previous = current[collection.key] ?? false;
			return {
				...current,
				[collection.key]:
					typeof value === "boolean" ? value : value(previous),
			};
		});
	};
	const [hasOverflow, setHasOverflow] = useState(false);

	useEffect(() => {
		const element = ref.current;
		if (!element) return;

		const observer = new ResizeObserver(() => {
			setHasOverflow(element.scrollHeight > MAX_COLLAPSED_HEIGHT);
		});
		observer.observe(element);

		return () => observer.disconnect();
	}, [collection.key]);
	
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
						initial={{ opacity: 0 }}
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
