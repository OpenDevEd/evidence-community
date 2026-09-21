"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import useSWR, { preload } from "swr";
import { Popover, PopoverContent, PopoverTrigger, SelectItem } from "@nextui-org/react";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { QuoteUpIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/nextui/Button";
import { Select } from "@/components/nextui/Select";
import CopyButton from "@/components/features/newlib/CopyButton";
import { ItemPropertyRowWrapper } from "@/components/features/newlib/ItemPropertyRow";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { CITATION_FORMATS, type CitationFormat, type CitationResponse } from "@/lib/citation-formats";
import { canCiteItem, type CitationItem } from "@/lib/citation-formats";
import { citationSource, loadCitations, type CitationRequest } from "@/lib/citation-client";
import { buildSiteUrl } from "@/lib/site-url";

function CitationContent({ loading, failed, text, format, retry }: {
	loading: boolean; failed: boolean; text?: string; format: CitationFormat; retry: () => void;
}) {
	const t = useTranslations("ui");
	if (loading) return <p role="status" className="text-sm text-black/50 dark:text-white/50">{t("loadingData")}</p>;
	if (failed) return <div role="alert" className="space-y-2 text-sm">
		<p>{t("citationLoadFailed")}</p><Button size="sm" onPress={retry}>{t("retry")}</Button>
	</div>;
	return <p className={`max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-black/70 dark:text-white/70 ${format === "bibtex" ? "font-mono text-xs" : "text-sm leading-relaxed"}`} aria-live="polite">{text}</p>;
}

function CitationActions({ format, onFormatChange, text }: {
	format: CitationFormat; onFormatChange: (format: CitationFormat) => void; text?: string;
}) {
	const t = useTranslations("ui");
	const label = CITATION_FORMATS.find(option => option.id === format)?.label;
	return <div className="flex max-w-full items-center justify-between gap-1">
		<Select aria-label={t("citationStyle")} title={label} selectedKeys={[format]} size="sm" placement="left"
			classNames={{
				base: "w-auto max-w-52",
				trigger: "h-8 min-h-8 min-w-24 rounded-lg pl-2.5 pr-7 shadow-none",
				innerWrapper: "w-full",
				value: "text-sm font-normal",
				selectorIcon: "!size-3.5 right-2.5",
				popoverContent: "min-w-60",
			}}
			popoverProps={{ placement: "bottom-end" }}
			onSelectionChange={(keys) => {
				const selected = CITATION_FORMATS.find(option => keys !== "all" && keys.has(option.id));
				if (selected) onFormatChange(selected.id);
			}}>
			{CITATION_FORMATS.map(option => <SelectItem key={option.id}>{option.label}</SelectItem>)}
		</Select>
		<span className="inline-flex size-8 shrink-0">
			{text && <CopyButton key={text} textToCopy={text} ariaLabel={t("copyCitation")} />}
		</span>
	</div>;
}

export function CitationPanel({ item, showHeading = false, completeRecord = false }: { item: CitationItem; showHeading?: boolean; completeRecord?: boolean }) {
	const t = useTranslations("ui");
	const locale = useLocale();
	const { citations: settings, identity } = useLibraryConfig();
	const [format, setFormat] = useState<CitationFormat>("apa");
	const source = citationSource(item, completeRecord);
	const request: CitationRequest = ["citations", source, locale, settings.showUrl ? buildSiteUrl(`/lib/${item.key}`, identity.baseUrl) : undefined];
	const { data, error, isLoading, mutate } = useSWR<CitationResponse>(settings.enabled ? request : null, loadCitations,
		{ revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false });
	if (!settings.enabled || (!isLoading && !error && !data?.citations)) return null;
	const text = data?.citations?.[format];
	const controls = <CitationActions format={format} onFormatChange={setFormat} text={text} />;
	const content = <CitationContent loading={isLoading} failed={Boolean(error)} text={text} format={format} retry={() => void mutate()} />;
	return <div className="w-full space-y-3" data-citation-state={isLoading ? "loading" : error ? "error" : "ready"}>
		{showHeading ? <ItemPropertyRowWrapper title={t("itemCitationTitle")} actions={controls}>{content}</ItemPropertyRowWrapper> : <>{controls}{content}</>}
	</div>;
}

export function CitationControl({ item }: { item: CitationItem | undefined }) {
	const t = useTranslations("ui");
	const { citations, identity } = useLibraryConfig();
	const locale = useLocale();
	const [open, setOpen] = useState(false);
	if (!citations.enabled || !canCiteItem(item)) return null;
	const prepare = () => {
		const request: CitationRequest = ["citations", citationSource(item, false), locale,
			citations.showUrl ? buildSiteUrl(`/lib/${item.key}`, identity.baseUrl) : undefined];
		void preload(request, loadCitations).catch(() => { /* The panel exposes retry if the request fails. */ });
	};
	return (
		<Popover isOpen={open} onOpenChange={setOpen} placement="bottom-end">
			<PopoverTrigger>
				<Button onPointerEnter={prepare} onFocus={prepare} size="sm" aria-label={t("cite")} startContent={<HugeiconsIcon icon={QuoteUpIcon} className="size-4" />}
					className="px-0 min-w-0 aspect-square @[720px]:aspect-auto @[720px]:px-3">
					<span className="hidden @[720px]:inline">{t("cite")}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72 max-w-full sm:w-96 items-stretch rounded-2xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-secondary">
				{open && <CitationPanel key={item.key} item={item} />}
			</PopoverContent>
		</Popover>
	);
}
