"use client";

import { useId, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { Popover, PopoverContent, PopoverTrigger, type InputProps } from "@nextui-org/react";
import {
	ArrowDown01Icon,
	Search01Icon,
	Tick01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Input } from "@/components/nextui/Input";
import { Spinner } from "@/components/nextui/Spinner";
import { twMerge } from "@/lib/tw-merge";
import { CITATION_FORMATS, type CitationStyle } from "@/lib/citation-formats";
import {
	loadCitationStyles,
	searchCitationStyles,
} from "@/lib/citation-styles";
import { TruncatedText } from "@/components/nextui/TruncatedText";

function StyleOption({
	style,
	selected,
	active,
	onSelect,
	onFocus,
	id,
	position,
	count,
}: {
	style: CitationStyle;
	selected: boolean;
	active: boolean;
	onSelect: () => void;
	onFocus: () => void;
	id: string;
	position: number;
	count: number;
}) {
	return (
		<button
			type="button"
			role="option"
			id={id}
			aria-selected={selected}
			aria-posinset={position}
			aria-setsize={count}
			tabIndex={-1}
			onPointerMove={onFocus}
			onMouseDown={(event) => event.preventDefault()}
			onClick={onSelect}
			className={`flex min-h-10 w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm leading-5 text-black/80 hover:bg-black/[0.04] dark:text-white/80 dark:hover:bg-white/[0.06] ${active ? "bg-black/[0.04] dark:bg-white/[0.06]" : ""}`}
		>
			<span className="min-w-0 flex-1 whitespace-normal break-words">
				{style.label}
			</span>
			{selected && (
				<HugeiconsIcon
					icon={Tick01Icon}
					className="mt-0.5 size-4 shrink-0 text-accent"
				/>
			)}
		</button>
	);
}

function StyleMenu({
	selected,
	onSelect,
  excludeBibtex,
}: {
	selected: CitationStyle | undefined;
	onSelect: (style: CitationStyle) => void;
  excludeBibtex: boolean;
}) {
	// TanStack Virtual measures rows outside React; its instance must stay reactive.
	"use no memo";
	const t = useTranslations("ui");
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const scrollRef = useRef<HTMLDivElement>(null);
	const listId = useId();
	const { data, error, isLoading, mutate } = useSWR(
		"citation-styles",
		loadCitationStyles,
		{ revalidateOnFocus: false, revalidateIfStale: false },
	);
	const matches = useMemo(
		() => searchCitationStyles(data ?? CITATION_FORMATS, query).filter(style => !excludeBibtex || style.id !== "bibtex"),
		[data, query, excludeBibtex],
	);
	const rows = useMemo(() => {
		const entries = matches.map((style, index) => ({ style, index }));
		if (query.trim()) return entries;
		const common = entries.filter(
			(entry) => entry.style.asset === undefined,
		);
		const other = entries.filter(
			(entry) => entry.style.asset !== undefined,
		);
		return [
			{ heading: t("commonCitationStyles") },
			...common,
			...(other.length
				? [{ heading: t("otherCitationStyles") }, ...other]
				: []),
		];
	}, [matches, query, t]);
	const activeRow = rows.findIndex(
		(row) => "index" in row && row.index === active,
	);
	const virtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: (index) => ("heading" in rows[index] ? 32 : 40),
		getItemKey: (index) =>
			"style" in rows[index] ? rows[index].style.id : rows[index].heading,
		overscan: 6,
		rangeExtractor: (range) =>
			[
				...new Set([
					...defaultRangeExtractor(range),
					...(activeRow >= 0 ? [activeRow] : []),
				]),
			].sort((a, b) => a - b),
	});
	const move = (index: number) => {
		const next = Math.max(0, Math.min(matches.length - 1, index));
		setActive(next);
		virtualizer.scrollToIndex(
			rows.findIndex((row) => "index" in row && row.index === next),
			{ align: "auto" },
		);
	};
	const onKeyDown = (event: Parameters<NonNullable<InputProps["onKeyDown"]>>[0]) => {
		if (event.key === "Escape") {
			// React Aria input handlers stop propagation unless explicitly continued.
			event.continuePropagation();
			return;
		}
		if (event.nativeEvent.isComposing || !matches.length) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			move(active + (event.key === "ArrowDown" ? 1 : -1));
		} else if (event.key === "Enter") {
			event.preventDefault();
			onSelect(matches[active]);
		}
	};
	return (
		<>
			<div className="shrink-0 p-2">
				<Input
					autoFocus
					size="sm"
					role="combobox"
					aria-label={t("searchCitationStyles")}
					placeholder={t("searchCitationStyles")}
					aria-expanded
					aria-autocomplete="list"
					aria-controls={listId}
					aria-activedescendant={
						matches[active]
							? `${listId}-${matches[active].id}`
							: undefined
					}
					value={query}
					onValueChange={(value) => {
						setQuery(value);
						setActive(0);
						virtualizer.scrollToOffset(0);
					}}
					onKeyDown={onKeyDown}
					startContent={
						<HugeiconsIcon
							icon={Search01Icon}
							className="size-4 shrink-0 text-black/40 dark:text-white/40"
						/>
					}
					classNames={{
						inputWrapper:
							"h-9 min-h-9 rounded-lg border-0 bg-black/[0.035] shadow-none dark:bg-white/[0.045]",
						input: "text-sm",
					}}
				/>
			</div>
			<div
				ref={scrollRef}
				role="listbox"
				id={listId}
				aria-label={t("citationStyle")}
				className="min-h-0 overflow-y-auto overscroll-contain px-1 pb-1"
				style={{
					height: Math.min(352, virtualizer.getTotalSize()),
					maxHeight: "50vh",
				}}
			>
				<div
					role="presentation"
					className="relative w-full"
					style={{ height: virtualizer.getTotalSize() }}
				>
					{virtualizer.getVirtualItems().map((virtual) => {
						const row = rows[virtual.index];
						return (
							<div
								key={virtual.key}
								data-index={virtual.index}
								ref={virtualizer.measureElement}
								role="presentation"
								className="absolute left-0 top-0 w-full"
								style={{
									transform: `translateY(${virtual.start}px)`,
								}}
							>
								{"heading" in row ? (
									<div className="px-3 pb-1 pt-3 text-xs font-medium text-black/50 dark:text-white/50">
										{row.heading}
									</div>
								) : (
									<StyleOption
										style={row.style}
										selected={selected?.id === row.style.id}
										active={active === row.index}
										id={`${listId}-${row.style.id}`}
										position={row.index + 1}
										count={matches.length}
										onFocus={() => setActive(row.index)}
										onSelect={() => onSelect(row.style)}
									/>
								)}
							</div>
						);
					})}
				</div>
			</div>
			{isLoading && matches.length === 0 && (
				<div role="status" aria-label={t("loadingData")} className="flex justify-center px-4 py-3">
					<Spinner size="sm" aria-hidden="true" />
				</div>
			)}
			{error && (
				<div role="alert" className="px-4 py-3 text-sm">
					<p>{t("citationStylesFailed")}</p>
					<Button size="sm" onPress={() => void mutate()}>
						{t("retry")}
					</Button>
				</div>
			)}
			{!isLoading && !error && matches.length === 0 && (
				<p
					role="status"
					className="px-4 py-3 text-sm text-black/50 dark:text-white/50"
				>
					{t("noCitationStyles")}
				</p>
			)}
		</>
	);
}

export function CitationStylePicker({
	selected,
	onSelect,
  excludeBibtex = false,
  className,
  isDisabled = false,
}: {
	selected: CitationStyle | undefined;
	onSelect: (style: CitationStyle) => void;
  excludeBibtex?: boolean;
  className?: string;
  isDisabled?: boolean;
}) {
	const t = useTranslations("ui");
	const [open, setOpen] = useState(false);
	return (
		<Popover
			isOpen={open}
			onOpenChange={setOpen}
			placement="bottom-end"
			shouldCloseOnScroll={false}
			classNames={{ base: "max-h-[inherit]" }}
			motionProps={{ className: "max-h-[inherit]" }}
		>
			<PopoverTrigger>
				<Button
					size="sm"
          isDisabled={isDisabled}
					aria-label={
						selected
							? `${t("citationStyle")}: ${selected.label}`
							: t("citationStyle")
					}
					className={twMerge("h-8 min-h-8 min-w-24 max-w-40 sm:max-w-64 justify-between gap-3 rounded-lg px-2.5 text-sm font-normal shadow-none", className)}
				>
					<TruncatedText text={selected?.label ?? t("citationStyle")} />
					<HugeiconsIcon
						icon={ArrowDown01Icon}
						className="size-3.5 shrink-0 text-black/60 dark:text-white/60"
					/>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-96 max-w-[calc(100vw-2rem)] max-h-[inherit] items-stretch overflow-hidden rounded-2xl border border-black/10 bg-white p-0 shadow-lg dark:border-white/10 dark:bg-secondary">
				{open && (
					<StyleMenu
            excludeBibtex={excludeBibtex}
						selected={selected}
						onSelect={(style) => {
							onSelect(style);
							setOpen(false);
						}}
					/>
				)}
			</PopoverContent>
		</Popover>
	);
}
