"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { IoSearch } from "react-icons/io5";
import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import { PropsOf } from "@nextui-org/react";
import { Input } from "@/components/nextui/Input";
import { useDebounce } from "@/hooks/useDebounce";
import { useInlineChatLayout } from "@/context/InlineChatLayout";

export function SearchBar({
	handleSearchChange,
	search,
	classNames,
	endContent,
	onCmdEnter,
	focusOnRequest,
}: {
	handleSearchChange: (search: string) => void;
	search: string;
	classNames?: PropsOf<typeof Input>["classNames"];
	/**
	 * Static node, or a render function receiving the live (undebounced)
	 * input value and a clear() that empties the field, cancels the pending
	 * debounce and resets the search param — use the function form for
	 * actions that consume the text instead of searching it.
	 */
	endContent?: ReactNode | ((liveText: string, clear: () => void) => ReactNode);
	/** Cmd/Ctrl+Enter with the live (undebounced) input value and clear(). */
	onCmdEnter?: (text: string, clear: () => void) => void;
	/**
	 * Honour `requestSearchFocus()` from the inline chat layout. Only the
	 * main library field should opt in; the engaged panel's compact copy
	 * unmounts at the moment the request is made.
	 */
	focusOnRequest?: boolean;
}) {
	// The extended NextUI Input does not type its ref as the DOM node, so
	// the field is resolved through its base wrapper instead.
	const baseRef = useRef<HTMLDivElement>(null);
	const { searchFocusRequest } = useInlineChatLayout();
	useEffect(() => {
		// Only fresh requests: this also runs when the field mounts after
		// the split layout closes, which is the case it exists for — but a
		// stale request must not steal focus on a later page visit.
		if (!focusOnRequest || Date.now() - searchFocusRequest > 1000) return;
		const element = baseRef.current?.querySelector("input");
		if (!element) return;
		element.focus({ preventScroll: true });
		element.setSelectionRange(element.value.length, element.value.length);
	}, [focusOnRequest, searchFocusRequest]);
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

	const clearSearch = () => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		lastDebouncedRef.current = "";
		setLocalValue("");
		handleSearchChange("");
	};

	return (
		<Input
			baseRef={baseRef}
			autoCorrect="off"
			value={localValue}
			onChange={(e) => {
				const value = e.target.value;
				lastDebouncedRef.current = value;
				setLocalValue(value);
				debouncedSearch(value);
			}}
			// NB: passing onClear at all makes NextUI render its clear button
			// and nest endContent inside it (pointer-events-none), so it must
			// be withheld whenever interactive endContent is present.
			onClear={endContent ? undefined : clearSearch}
			onKeyDown={(e) => {
				if (
					onCmdEnter &&
					e.key === "Enter" &&
					(e.metaKey || e.ctrlKey)
				) {
					e.preventDefault();
					onCmdEnter(localValue, clearSearch);
				}
			}}
			placeholder={t("search")}
			size={"lg"}
			classNames={{
				...classNames,
				inputWrapper: twMerge(
					"h-10 lg:h-12 min-h-10 lg:min-h-12",
					// Equalise the endContent inset with its vertical gap.
					endContent && "pr-1.5",
					classNames?.inputWrapper,
				),
				base: twMerge("col-span-2", classNames?.base),
			}}
			// NextUI nests endContent inside the (pointer-events-none) clear
			// button when isClearable is set, which would make any
			// interactive endContent unclickable.
			isClearable={!endContent}
			startContent={
				<IoSearch
					aria-label={t("searchIconAriaLabel")}
					className="size-6 fill-current text-black/60 dark:text-white/40"
				/>
			}
			endContent={
				// clearSearch only touches the debounce ref when invoked from
				// event handlers, never during render.
				typeof endContent === "function"
					? // eslint-disable-next-line react-hooks/refs
						endContent(localValue, clearSearch)
					: endContent
			}
		/>
	);
}
