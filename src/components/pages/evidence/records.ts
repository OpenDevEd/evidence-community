import { useMemo, useState } from "react";
import useSWR from "swr";
import type { ListItem } from "@/app/api/item/types";
import type { More } from "./client";
import type { Label } from "./data";
import type { Selection } from "./graph";

/** A record's first author's last name, with "et al." when there are more. */
export function whoOf(item: ListItem | null | undefined) {
	const creators = item?.creators ?? [];
	const first = creators[0];
	if (!first) return null;
	const name = first.lastName || (first.name ?? "").split(" ").at(-1) || "";
	return creators.length > 1 ? `${name} et al.` : name;
}

export const yearOf = (item: ListItem | null | undefined) => Number(String(item?.date ?? "").match(/\d{4}/)?.[0]) || null;

/** A record's line in a list: who, when and its title. */
export const labelOfRecord = (record: ListItem): Label => ({ who: whoOf(record) ?? "Unknown author", year: yearOf(record), title: record.title || undefined });

const batch = async (keys: string[]): Promise<ListItem[]> => {
	const response = await fetch("/api/items/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys, page: 1, perPage: keys.length }) });
	return (await response.json()).items ?? [];
};
const kept = { revalidateOnFocus: false, dedupingInterval: 600_000 };

/** A library record's card, from the library's search index; null when the search does not return it. */
export function useRecord(key: string | null) {
	return useSWR<ListItem | null>(key ? ["evidence-record", key] : null, async () => (await batch([key!]))[0] ?? null, kept);
}

/** Records for papers a list shows without a title of their own: one request for the lot. */
function useRecords(keys: string[]) {
	const wanted = keys.slice(0, 40);
	const { data } = useSWR<ListItem[]>(wanted.length ? ["evidence-records", ...wanted] : null, () => batch(wanted), kept);
	return useMemo(() => new Map((data ?? []).map((item) => [item.key, item])), [data]);
}

/** A paper's line: the labels file's name and year, and its title from the evidence map or else the record. */
export function lineOf(index: number, more: More, records: Map<string, ListItem>): Label | undefined {
	const label = more.labels.get(index), record = records.get(more.keyOf(index) ?? "");
	if (!label) return record ? labelOfRecord(record) : undefined;
	return { who: label.who, year: label.year ?? yearOf(record), title: label.title ?? record?.title ?? undefined };
}

/** The records for these papers' lines, looked up for the ones the labels file gives no title. */
export function useLines(indices: number[], more: More) {
	return useRecords(indices.filter((i) => !more.labels.get(i)?.title).flatMap((i) => more.keyOf(i) ?? []));
}

/** The opened paper's name for the map, from its record, when the labels file has none: it names only papers cited often. */
export function useOpenedName(index: number | null, more: More | null): Label | null {
	const key = index === null || !more || more.labels.get(index) ? null : more.keyOf(index);
	const { data: record } = useRecord(key);
	return key && record ? labelOfRecord(record) : null;
}

type Shown = { selection: Selection; record: ListItem | null | undefined };

/**
 * What the paper panel shows. A library record's title can be long, so a paper shows once its record is in, rather than with a
 * line that grows; a paper outside the library has everything in the evidence map. While the next paper opens, the one before
 * stays, dimmed and out of reach, so the panel never empties between two; it goes once nothing is opening.
 */
export function usePaper(selection: Selection | null, more: More | null, opening: boolean) {
	const current = useCurrentPaper(selection, more);
	const shown = useKept(current, !selection && !opening);
	return { shown, stale: Boolean(shown && !current) };
}

/** The opened paper with its record, once the record is in. */
function useCurrentPaper(selection: Selection | null, more: More | null): Shown | null {
	const { data: record, isLoading } = useRecord(selection && more ? more.keyOf(selection.index) : null);
	return selection && more && !isLoading ? { selection, record } : null;
}

/** The last paper shown, kept until `release` says nothing is opening any more. */
function useKept(current: Shown | null, release: boolean) {
	const [kept, setKept] = useState<Shown | null>(null);
	if (current && !sameShown(kept, current)) setKept(current);
	if (!current && release && kept) setKept(null);
	return current ?? kept;
}

const sameShown = (a: Shown | null, b: Shown) => a?.selection === b.selection && a.record === b.record;
