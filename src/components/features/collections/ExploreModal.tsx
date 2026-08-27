"use client";

import { Modal, ModalContent } from "@nextui-org/react";
import { useTranslations } from "next-intl";
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
export default function ExploreModal({
	isOpen,
	onOpenChange,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("ui");
	const itemsContext = useFiltersContext();

	return (
		<Modal
			backdrop="opaque"
			size="2xl"
			placement="center"
			hideCloseButton
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			classNames={{
				// Top-anchor the panel on mobile so a tall filter list opens at
				// the top (centering it would push the top off-screen).
				wrapper: "max-sm:items-start",
				backdrop:
					"max-sm:bg-background_light-400 max-sm:dark:bg-background-400",
				// NB: we deliberately do NOT use scrollBehavior="inside" — that
				// turns the wrapper into a transformed scroll container which
				// trips a Chromium elementFromPoint bug, breaking left-side
				// backdrop dismissal. Instead we bound the base height and scroll
				// the filter list internally ourselves (below), which keeps the
				// contained look while leaving backdrop hit-testing correct.
				base: twMerge(
					"bg-background_light dark:bg-card outline-none",
					// Full-screen on mobile: pin the panel to the viewport height
					// (NOT min-height — otherwise it grows past the screen and the
					// inner scroll never engages), then scroll the list inside.
					"max-sm:m-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:max-w-full max-sm:rounded-none",
					"sm:my-6 sm:max-h-[85dvh] sm:border sm:border-black/10 sm:dark:border-white/10 sm:rounded-large",
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
								handleAuthorCountrySelect={
									itemsContext.handleAuthorCountrySelect
								}
							/>
						</div>
					</>
				)}
			</ModalContent>
		</Modal>
	);
}
