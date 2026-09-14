"use client";

import type { IconType } from "react-icons";
import { GiArchiveResearch } from "react-icons/gi";
import { FaSort } from "react-icons/fa";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
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
	Icon: IconType;
	className?: string;
	label?: string;
}) {
	return (
		<div className="size-8 bg-white/10 rounded-full p-2 aspect-square shrink-0">
			<Icon
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

const personalSelectClassNames = {
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
			startContent={<DropDownIcon label="Sort icon" Icon={FaSort} />}
			selectedKeys={
				itemsContext.queryParams.sort && [itemsContext.queryParams.sort]
			}
			onSelectionChange={itemsContext.handleSortChange as any}
			items={SORT_OPTIONS}
			selectorIcon={<div className="hidden"></div>}
			classNames={
				!itemsContext.userData &&
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
					: personalSelectClassNames
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
				<DropDownIcon label="Scope icon" Icon={GiArchiveResearch} />
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
			classNames={
				!itemsContext.userData
					? {
							base: twMerge(
								"lg:max-w-72 max-w-full",
								itemsContext.config.interactionsStyle ===
									"one-line" && "flex-1",
								genericSelectClassNames.base,
							),
							mainWrapper: twMerge(
								"h-10 lg:h-full",
								genericSelectClassNames.mainWrapper,
							),
							label: twMerge("", genericSelectClassNames.label),
						}
					: personalSelectClassNames
			}
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
