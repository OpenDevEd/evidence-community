"use client";

import { createContext, ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useFormatter } from "next-intl";
import { useItemsList } from "@/hooks/useItemsList";
import { ResourcesView } from "../resources/ResourcesView";
import { ResultsTranslationProvider } from "../translation/ResultsTranslation";
import { SemanticProvider } from "../semantic/SemanticConcepts";

function NumberWrapper({ children }: { children: ReactNode }) {
	return (
		<span className="text-xl font-medium text-black/80 dark:text-white/80">
			{children}
		</span>
	);
}

function CollectionWrapper({ children }: { children: ReactNode }) {
	return (
		<span className="text-sm text-black/60 dark:text-white/60">
			{children}
		</span>
	);
}

export const ItemsContext = createContext<ReturnType<typeof useItemsList>>({} as ReturnType<typeof useItemsList>);

export default function ItemsList({
	userData,
	extraFilters,
	props,
}: {
	userData?: any;
	extraFilters?: ReactNode;
	props: ReturnType<typeof useItemsList>;
}) {
	const t = useTranslations("ui");
	const formatter = useFormatter();

	return (
		<ItemsContext.Provider value={props}>
			<SemanticProvider
				value={{
					concept: props.queryParams.concept,
					theme: props.queryParams.theme,
					total: props.itemsData?.totalItems ?? 0,
					semantic: props.itemsData?.semantic,
					change: props.handleSemanticChange,
				}}
			>
			<ResultsTranslationProvider items={props.itemsData?.items}>
			<ResourcesView
				extraFilters={extraFilters}
				{...(!userData
					? {}
					: {
							params: {
								id: userData.id,
							},
							countLabel: (
								<div>
									{props.queryParams.collectionId
										? t.rich("itemsInCollection", {
												count: formatter.number(
													props.itemsData
														?.totalItems || 0
												),
												number: (chunks) => (
													<NumberWrapper>
														{chunks}
													</NumberWrapper>
												),
												collection:
													userData.collections.find(
														(collection: any) =>
															collection.id ===
															props.queryParams
																.collectionId
													)?.name,
												collections: (chunks) => (
													<CollectionWrapper>
														{chunks}
													</CollectionWrapper>
												),
										  })
										: t.rich("likedItemsCount", {
												count: formatter.number(
													props.itemsData
														?.totalItems || 0
												),
												number: (chunks) => (
													<NumberWrapper>
														{chunks}
													</NumberWrapper>
												),
										  })}
								</div>
							),
					  })}
			/>
			</ResultsTranslationProvider>
			</SemanticProvider>
		</ItemsContext.Provider>
	);
}
