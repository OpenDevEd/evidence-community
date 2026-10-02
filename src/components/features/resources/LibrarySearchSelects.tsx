"use client";

import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/Hugeicon";
import { BookSearchIcon, Sorting01Icon } from "@hugeicons/core-free-icons";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { twMerge } from "@/lib/tw-merge";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { SORT_OPTIONS } from "@/constants/items";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { getRuntimeSearchScopeOptions } from "@/config/library-config/search";
import type { useItemsList } from "@/hooks/useItemsList";

function DropDownIcon({
	Icon,
	className,
	label,
}: {
	Icon: IconSvgElement;
	className?: string;
	label?: string;
}) {
	return (
		<div className="size-8 bg-white/10 rounded-full p-2 aspect-square shrink-0">
			<HugeiconsIcon
				icon={Icon}
				className={twMerge("w-full h-full", className)}
				aria-label={label}
			/>
		</div>
	);
}

const genericSelectClassNames = {
	base: "!mt-0",
	mainWrapper: "h-10 lg:h-full",
	label: "hidden",
};

/** Sort in the one-line layout, where it shares the row with the search. */
const oneLineSelectClassNames = {
	base: twMerge(
		"flex-1 max-w-full min-w-0 lg:min-w-56",
		genericSelectClassNames.base,
	),
	mainWrapper: twMerge("", genericSelectClassNames.mainWrapper),
	label: twMerge("", genericSelectClassNames.label),
};

export function SortComponent({
	itemsContext,
}: {
	itemsContext: ReturnType<typeof useItemsList>;
}) {
	const tSorts = useTranslations("sorts");

	return (
		<Select
			startContent={<DropDownIcon label="Sort icon" Icon={Sorting01Icon} />}
			selectedKeys={
				itemsContext.queryParams.sort && [itemsContext.queryParams.sort]
			}
			onSelectionChange={itemsContext.handleSortChange as any}
			items={SORT_OPTIONS}
			selectorIcon={<div className="hidden"></div>}
			classNames={
				itemsContext.config.interactionsStyle !== "one-line"
					? {
							base: twMerge(
								"flex-1 max-w-full lg:flex-none lg:w-56 lg:max-w-56 shrink-0",
								genericSelectClassNames.base,
							),
							mainWrapper: twMerge(
								"h-full",
								genericSelectClassNames.mainWrapper,
							),
							label: twMerge("", genericSelectClassNames.label),
						}
					: oneLineSelectClassNames
			}
			label={"Sort by"}
			labelPlacement="outside"
		>
			{(item: any) => {
				return (
					<SelectItem aria-label={tSorts(item.key)} key={item.key}>
						{tSorts(item.key)}
					</SelectItem>
				);
			}}
		</Select>
	);
}

export function ScopeComponent({
	itemsContext,
}: {
	itemsContext: ReturnType<typeof useItemsList>;
}) {
	const tScopes = useTranslations("scopes");
	const { search } = useLibraryConfig();
	const scopeOptions = useMemo(
		() => getRuntimeSearchScopeOptions(search),
		[search],
	);

	return (
		<Select
			startContent={
				<DropDownIcon label="Scope icon" Icon={BookSearchIcon} />
			}
			color="tertiary"
			selectedKeys={
				itemsContext.queryParams.scope && [
					itemsContext.queryParams.scope,
				]
			}
			onSelectionChange={itemsContext.handleScopeChange as any}
			items={scopeOptions}
			selectorIcon={<div className="hidden"></div>}
			classNames={{
				// On its own line (the map's list) the scope has the whole
				// row, so its label is not cut short.
				base: twMerge(
					"max-w-full",
					itemsContext.config.interactionsStyle !== "one-line" &&
						"lg:max-w-72",
					genericSelectClassNames.base,
				),
				mainWrapper: twMerge(
					"h-10 lg:h-full",
					genericSelectClassNames.mainWrapper,
				),
				label: twMerge("", genericSelectClassNames.label),
			}}
			label={"Search scope"}
			labelPlacement="outside"
		>
			{(item: any) => {
				return (
					<SelectItem aria-label={tScopes(item.key)} key={item.key}>
						{tScopes(item.key)}
					</SelectItem>
				);
			}}
		</Select>
	);
}
