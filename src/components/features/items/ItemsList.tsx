"use client";

import { type ReactNode } from "react";
import { ItemsContext } from "@/context/ItemsContext";
import { useTranslations } from "next-intl";
import { useFormatter } from "next-intl";
import { useItemsList } from "@/hooks/useItemsList";
import { ResourcesView } from "../resources/ResourcesView";

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

export default function ItemsList({
	userData,
	extraFilters,
	props,
	contentId,
	header,
	headerAction,
	headerDetails,
}: {
	contentId?: string;
	/** The list's heading, in place of the library's own. */
	header?: ReactNode;
	headerAction?: ReactNode;
	headerDetails?: ReactNode;
	userData?: any;
	extraFilters?: ReactNode;
	props: ReturnType<typeof useItemsList>;
}) {
	const t = useTranslations("ui");
	const formatter = useFormatter();

	return (
		<ItemsContext.Provider value={props}>
			<ResourcesView
				contentId={contentId}
				header={header}
				headerAction={headerAction}
				headerDetails={headerDetails}
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
		</ItemsContext.Provider>
	);
}
