"use client";

import { Modal, ModalContent } from "@nextui-org/react";
import { useLocale, useTranslations } from "next-intl";
import { useReducedMotion } from "framer-motion";
import { getLangDir } from "rtl-detect";
import { twMerge } from "tailwind-merge";
import GenericHeader from "@/components/features/modals/GenericHeader";
import CollectionsList from "@/components/features/collections/CollectionsList";
import { useFiltersContext } from "@/context/FiltersProvider";

/**
 * The Explore (filter) modal — collections + year + institutions + countries.
 *
 * Extracted from the library page so the navbar and the library share the exact
 * same modal. Reads the app-level shared filter state directly, so wherever it
 * is opened it operates on the same nuqs params with no per-caller fetch.
 *
 * Full-screen on mobile; a normal centered modal on desktop.
 */
// NextUI renders the panel with animate="enter" / exit="exit", so custom
// motion must be expressed as named variants.
const SHEET_MOTION = {
	variants: {
		enter: {
			x: 0,
			opacity: 1,
			transition: { type: "spring", stiffness: 320, damping: 34 },
		},
		exit: (direction: number) =>
			({
				x: direction * 48,
				opacity: 0,
				transition: { duration: 0.2, ease: [0.4, 0, 1, 1] },
			}) as const,
	},
	initial: "exit",
} as const;

export default function ExploreModal({
	isOpen,
	onOpenChange,
	variant = "dialog",
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	 * `sheet` docks the panel to the trailing edge on desktop (used in split
	 * chat mode so the filters sit beside the results instead of covering
	 * the whole page). Mobile is full-screen in both variants.
	 */
	variant?: "dialog" | "sheet";
}) {
	const t = useTranslations("ui");
	const isRTL = getLangDir(useLocale()) === "rtl";
	const itemsContext = useFiltersContext();
	const isSheet = variant === "sheet";
	const reducedMotion = useReducedMotion();

	return (
		<Modal
			backdrop="opaque"
			size="2xl"
			placement="center"
			hideCloseButton
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			disableAnimation={Boolean(reducedMotion)}
			motionProps={
				isSheet
					? { ...SHEET_MOTION, custom: isRTL ? -1 : 1 }
					: undefined
			}
			classNames={{
				// Top-anchor the panel on mobile so a tall filter list opens at
				// the top (centering it would push the top off-screen).
				wrapper: twMerge(
					"max-sm:items-start",
					isSheet && "sm:items-stretch sm:justify-end",
				),
				backdrop: twMerge(
					"max-sm:bg-background_light-400 max-sm:dark:bg-background-400",
					// Sheet: dim the page behind it so the panel reads as a
					// layer above the split view.
					isSheet && "sm:bg-black/45 sm:backdrop-blur-[2px]",
				),
				// NB: we deliberately do NOT use scrollBehavior="inside" — that
				// turns the wrapper into a transformed scroll container which
				// trips a Chromium elementFromPoint bug, breaking left-side
				// backdrop dismissal. Instead we bound the base height and scroll
				// the filter list internally ourselves (below), which keeps the
				// contained look while leaving backdrop hit-testing correct.
				base: twMerge(
					"bg-background_light/95 dark:bg-card/95 outline-none",
					// Full-screen on mobile: pin the panel to the viewport height
					// (NOT min-height — otherwise it grows past the screen and the
					// inner scroll never engages), then scroll the list inside.
					"max-sm:m-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:rounded-none",
					isSheet
						? "sm:m-0 sm:h-dvh sm:max-h-dvh sm:w-[26rem] sm:max-w-[90vw] sm:rounded-none sm:rounded-s-large sm:border-s sm:border-black/10 sm:shadow-[-24px_0_60px_-30px_rgba(0,0,0,0.45)] sm:dark:border-white/10 rtl:sm:shadow-[24px_0_60px_-30px_rgba(0,0,0,0.45)]"
						: "sm:my-6 sm:max-h-[85dvh] sm:border sm:border-black/10 sm:dark:border-white/10 sm:rounded-large",
				),
			}}
		>
			<ModalContent>
				{(onClose: any) => (
					<>
						<GenericHeader onClose={onClose}>
							{t("explore")}
						</GenericHeader>
						<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
							<CollectionsList
								data={itemsContext.collectionsData}
								handleCheckboxChange={
									itemsContext.handleCheckboxChange
								}
								selectedCollections={
									itemsContext.selectedCollections
								}
								hierarchy={itemsContext.hierarchy!}
								isModal
								range={itemsContext.queryParams.range}
								handleRangeChange={
									itemsContext.handleRangeChange
								}
								facetDistribution={
									itemsContext.facetDistribution
								}
								queryParams={itemsContext.queryParams}
								handleInstitutionSelect={
									itemsContext.handleInstitutionSelect
								}
								handleCountrySelect={
									itemsContext.handleCountrySelect
								}
							/>
						</div>
					</>
				)}
			</ModalContent>
		</Modal>
	);
}
