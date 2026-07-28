"use client";

import { ReactNode, useState } from "react";
import { IoSearch } from "react-icons/io5";
import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import { PropsOf } from "@nextui-org/react";
import { Input } from "@/components/nextui/Input";
import { useDebounce } from "@/hooks/useDebounce";

export function SearchBar({
	handleSearchChange,
	search,
	classNames,
	endContent,
}: {
	handleSearchChange: (search: string) => void;
	search: string;
	classNames?: PropsOf<typeof Input>["classNames"];
	endContent?: ReactNode;
}) {
	const [draft, setDraft] = useState({
		sourceSearch: search,
		value: search,
	});
	const [debouncedSearch, debounceRef] = useDebounce(handleSearchChange, 300);
	const t = useTranslations("ui");
	const localValue =
		draft.sourceSearch === search || draft.value === search
			? draft.value
			: search;

	if (draft.sourceSearch !== search) {
		setDraft({
			sourceSearch: search,
			value: localValue,
		});
	}

	return (
		<Input
			autoCorrect="off"
			value={localValue}
			onChange={(e) => {
				const value = e.target.value;
				setDraft({ sourceSearch: search, value });
				debouncedSearch(value);
			}}
			onClear={() => {
				if (debounceRef.current) clearTimeout(debounceRef.current);
				setDraft({ sourceSearch: search, value: "" });
				handleSearchChange("");
			}}
			placeholder={t("search")}
			size={"lg"}
			classNames={{
				...classNames,
				inputWrapper: twMerge(
					"h-10 lg:h-12 min-h-10 lg:min-h-12",
					classNames?.inputWrapper,
				),
				base: twMerge("col-span-2", classNames?.base),
			}}
			isClearable
			startContent={
				<IoSearch
					aria-label={t("searchIconAriaLabel")}
					className="size-6 fill-current text-black/60 dark:text-white/40"
				/>
			}
			endContent={endContent}
		/>
	);
}
