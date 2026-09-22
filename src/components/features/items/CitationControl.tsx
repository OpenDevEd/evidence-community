"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import useSWR, { preload } from "swr";
import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { QuoteUpIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/nextui/Button";
import { CitationStylePicker } from "./CitationStylePicker";
import CopyButton from "@/components/features/newlib/CopyButton";
import { ItemPropertyRowWrapper } from "@/components/features/newlib/ItemPropertyRow";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { CITATION_FORMATS, type CitationStyle, type CitationResponse } from "@/lib/citation-formats";
import { canCiteItem, type CitationItem } from "@/lib/citation-formats";
import { citationSource, loadCitations, loadAdditionalCitation, type CitationRequest } from "@/lib/citation-client";
import { buildSiteUrl } from "@/lib/site-url";

function CitationContent({ loading, failed, text, format, retry }: {
	loading: boolean; failed: boolean; text?: string; format: string; retry: () => void;
}) {
	const t = useTranslations("ui");
	if (loading) return <p role="status" className="text-sm text-black/50 dark:text-white/50">{t("loadingData")}</p>;
	if (failed) return <div role="alert" className="space-y-2 text-sm">
		<p>{t("citationLoadFailed")}</p><Button size="sm" onPress={retry}>{t("retry")}</Button>
	</div>;
	return <p className={`max-h-72 overflow-y-auto whitespace-pre-wrap break-words text-black/70 dark:text-white/70 ${format === "bibtex" ? "font-mono text-xs" : "text-sm leading-relaxed"}`} aria-live="polite">{text}</p>;
}

function CitationActions({ format, onFormatChange, text }: {
	format: CitationStyle; onFormatChange: (format: CitationStyle) => void; text?: string;
}) {
	const t = useTranslations("ui");
	return <div className="flex max-w-full items-center justify-between gap-1">
		<CitationStylePicker selected={format} onSelect={onFormatChange} />
		<span className="inline-flex size-8 shrink-0">
			{text && <CopyButton key={text} textToCopy={text} ariaLabel={t("copyCitation")} />}
		</span>
	</div>;
}

function useCitationResult(request: CitationRequest, format: CitationStyle, enabled: boolean) {
	const base = useSWR<CitationResponse>(enabled ? request : null, loadCitations,
		{ revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false });
	const record = format.asset && base.data?.record;
	const extra = useSWR(record ? ["citation-style", record, request[2], format, request[3]] as const : null, loadAdditionalCitation,
		{ revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false });
	const current = record ? extra : base;
	const text = format.asset !== undefined ? extra.data : base.data?.citations?.[format.id];
	return { text, loading: current.isLoading, failed: Boolean(current.error), available: base.data?.citations !== null,
		retry: () => { void current.mutate(); } };
}

export function CitationPanel({ item, showHeading = false, completeRecord = false }: { item: CitationItem; showHeading?: boolean; completeRecord?: boolean }) {
	const t = useTranslations("ui");
	const locale = useLocale();
	const { citations: settings, identity } = useLibraryConfig();
	const [format, setFormat] = useState<CitationStyle>(CITATION_FORMATS[0]);
	const source = citationSource(item, completeRecord);
	const request: CitationRequest = ["citations", source, locale, settings.showUrl ? buildSiteUrl(`/lib/${item.key}`, identity.baseUrl) : undefined];
	const { text, loading, failed, available, retry } = useCitationResult(request, format, settings.enabled);
	if (!settings.enabled || !available) return null;
	const controls = <CitationActions format={format} onFormatChange={setFormat} text={text} />;
	const content = <CitationContent loading={loading} failed={failed} text={text} format={format.id} retry={retry} />;
	return <div className="w-full space-y-3" data-citation-state={loading ? "loading" : failed ? "error" : "ready"}>
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
