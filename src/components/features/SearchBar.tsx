"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { twMerge } from "@/lib/tw-merge";
import { PropsOf } from "@nextui-org/react";
import { Input } from "@/components/nextui/Input";
import { useDebounce } from "@/hooks/useDebounce";
import { followsInThisTab } from "@/lib/follows-in-this-tab";
import { useInlineChatLayout } from "@/context/InlineChatLayout";

/** A focus request older than this belongs to an earlier page visit. */
const FOCUS_REQUEST_MAX_AGE_MS = 1000;

type Draft = { sourceSearch: string; value: string };

/**
 * The field's search, run once typing stops: run, cancel, and run now. A search still waiting when the field goes away
 * (a result followed straight after typing) never runs, since it would write the next page's address. It stops being
 * what was typed, and a page kept for Back shows the search it has again, not the words that never ran.
 */
function useWaitingSearch(
	handleSearchChange: (search: string) => void,
	setDraft: (update: (draft: Draft) => Draft) => void,
	onTyped?: (text: string | null) => void,
) {
	const [run, , cancel, now] = useDebounce((text: string) => {
		onTyped?.(null);
		handleSearchChange(text);
	}, 300);
	// The timer is the outside system: this drops what it still holds.
	useEffect(
		() => () => {
			cancel();
			onTyped?.(null);
			setDraft((draft) => ({ ...draft, value: draft.sourceSearch }));
		},
		[cancel, onTyped, setDraft],
	);
	// The document's clicks: a link followed in this tab straight after typing leaves the page, and the waiting search
	// must not write this page's address under that navigation. Listened to in capture, before the link navigates.
	useEffect(() => {
		const leave = (event: MouseEvent) => {
			const link = (event.target as Element | null)?.closest?.("a[href]");
			if (!link || !followsInThisTab(event) || link.getAttribute("target") === "_blank") return;
			if (link.getAttribute("href")?.startsWith("#")) return;
			cancel();
			onTyped?.(null);
		};
		document.addEventListener("click", leave, true);
		return () => document.removeEventListener("click", leave, true);
	}, [cancel, onTyped]);
	return [run, cancel, now] as const;
}

export function SearchBar({
	handleSearchChange,
	onTyped,
	search,
	classNames,
	endContent,
	focusOnRequest,
	onAsk,
	trailing,
}: {
	handleSearchChange: (search: string) => void;
	/** What the field holds while its search waits to run, and null once it has run or been cleared. */
	onTyped?: (text: string | null) => void;
	search: string;
	classNames?: PropsOf<typeof Input>["classNames"];
	/** A fixed node drawn inside the field, such as an icon. */
	endContent?: ReactNode;
	/**
	 * Drawn over the end of the field, outside it. Anything the field draws
	 * inside itself keeps the text as it was when the field was first drawn,
	 * so a control that acts on what the reader typed belongs here.
	 */
	trailing?: (ask: () => void) => ReactNode;
	/**
	 * Take focus when the chat beside the results asks for it. Only the main
	 * library field should: the copy inside the chat is gone by then.
	 */
	focusOnRequest?: boolean;
	/**
	 * Takes the text away from the field: the reader is asking with it, not
	 * searching for it. Both Ctrl or Cmd with Enter and any button in
	 * `endContent` come through here, so they always send what the field
	 * holds at that moment rather than what it held when it was drawn.
	 */
	onAsk?: (text: string, clear: () => void) => void;
}) {
	// The extended field does not hand back the input itself, so it is found
	// through the wrapper around it.
	const baseRef = useRef<HTMLDivElement>(null);
	const { searchFocusRequest } = useInlineChatLayout();

	useEffect(() => {
		// This also runs when the field comes back after the split view
		// closes, which is what it is for. An old request must not steal
		// focus on a later visit.
		if (
			!focusOnRequest ||
			Date.now() - searchFocusRequest > FOCUS_REQUEST_MAX_AGE_MS
		) {
			return;
		}
		const element = baseRef.current?.querySelector("input");
		if (!element) return;
		element.focus({ preventScroll: true });
		element.setSelectionRange(element.value.length, element.value.length);
	}, [focusOnRequest, searchFocusRequest]);
	const [draft, setDraft] = useState<Draft>({
		sourceSearch: search,
		value: search,
	});
	const [debouncedSearch, cancelSearch, searchNow] = useWaitingSearch(
		handleSearchChange,
		setDraft,
		onTyped,
	);
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

	const clear = useCallback(() => {
		// Drop the search that was still waiting to run: letting it through
		// would change the page address a second time, moments later.
		cancelSearch();
		onTyped?.(null);
		setDraft({ sourceSearch: search, value: "" });
		handleSearchChange("");
	}, [cancelSearch, handleSearchChange, onTyped, search]);

	const ask = () => onAsk?.(localValue, clear);

	const field = (
		<Input
			baseRef={baseRef}
			autoCorrect="off"
			onKeyDown={(event) => {
				if (event.key !== "Enter") return;
				if (!(event.metaKey || event.ctrlKey)) {
					// Searched at once on Enter only. Searching when the box loses focus moved the results under the button
					// being pressed, and that click was lost. Open in OpenScholar reads what was typed itself (onTyped).
					searchNow();
					return;
				}
				event.preventDefault();
				ask();
			}}
			value={localValue}
			onChange={(e) => {
				const value = e.target.value;
				setDraft({ sourceSearch: search, value });
				onTyped?.(value);
				debouncedSearch(value);
			}}
			onClear={clear}
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
				<HugeiconsIcon icon={Search01Icon}
					aria-label={t("searchIconAriaLabel")}
					className="size-6 text-black/60 dark:text-white/40"
				/>
			}
			endContent={endContent}
		/>
	);

	if (!trailing) return field;

	return (
		<div className="relative flex min-w-0 flex-1 items-center">
			{field}
			<div className="absolute inset-y-0 right-3 flex items-center">
				{trailing(ask)}
			</div>
		</div>
	);
}
