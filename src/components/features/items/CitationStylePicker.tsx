"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { AutocompleteItem } from "@nextui-org/react";
import { Autocomplete } from "@/components/nextui/Autocomplete";
import { Button } from "@/components/nextui/Button";
import { CITATION_FORMATS, type CitationStyle } from "@/lib/citation-formats";
import { loadCitationStyles } from "@/lib/citation-styles";

export function CitationStylePicker({ selected, onSelect }: { selected: CitationStyle; onSelect: (style: CitationStyle) => void }) {
  const t = useTranslations("ui");
  const [open, setOpen] = useState(false);
  const { data, error, isLoading, mutate } = useSWR(open ? "citation-styles" : null, loadCitationStyles,
    { revalidateOnFocus: false, revalidateIfStale: false, keepPreviousData: true });
  return <Autocomplete aria-label={t("citationStyle")} title={selected.label} placeholder={t("searchCitationStyles")}
    defaultItems={data ?? CITATION_FORMATS} selectedKey={selected.id} isClearable={false}
    onOpenChange={setOpen}
    onSelectionChange={key => { const style = (data ?? CITATION_FORMATS).find(option => option.id === key); if (style) onSelect(style); }}
    size="sm" menuTrigger="focus" isLoading={isLoading}
    className="w-52 max-w-full"
    inputProps={{ classNames: { inputWrapper: "h-8 min-h-8 rounded-lg border border-black/10 bg-white px-2.5 shadow-none dark:border-white/10 dark:bg-secondary", input: "truncate text-sm text-black/80 dark:text-white/60" } }}
    selectorButtonProps={{ className: "size-5 min-w-5 text-black/60 dark:text-white/60" }}
    popoverProps={{ placement: "bottom-end", style: { minWidth: "min(20rem, calc(100vw - 2rem))" }, classNames: { content: "w-full rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-secondary" } }}
    listboxProps={{ emptyContent: error ? <div role="alert"><p>{t("citationStylesFailed")}</p><Button size="sm" onPress={() => void mutate()}>{t("retry")}</Button></div> : isLoading ? t("loadingData") : t("noCitationStyles") }}>
    {(item: object) => { const style = item as CitationStyle; return <AutocompleteItem key={style.id} textValue={style.label} title={style.label}
      classNames={{ title: "truncate" }}>{style.label}</AutocompleteItem>; }}
  </Autocomplete>;
}
