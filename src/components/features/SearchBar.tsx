"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
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
	const [localValue, setLocalValue] = useState(search);
	const [debouncedSearch, debounceRef] = useDebounce(handleSearchChange, 300);
	const t = useTranslations("ui");
	const lastDebouncedRef = useRef(search);

	// Only sync when the URL param changes externally (back button, programmatic reset)
	// Skip when the change came from our own debounced update
	useEffect(() => {
		if (search !== lastDebouncedRef.current) {
			setLocalValue(search);
		}
		lastDebouncedRef.current = search;
	}, [search]);

	return (
		<Input
			autoCorrect="off"
			value={localValue}
			onChange={(e) => {
				const value = e.target.value;
				lastDebouncedRef.current = value;
				setLocalValue(value);
				debouncedSearch(value);
			}}
			onClear={() => {
				if (debounceRef.current) clearTimeout(debounceRef.current);
				lastDebouncedRef.current = "";
				setLocalValue("");
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
