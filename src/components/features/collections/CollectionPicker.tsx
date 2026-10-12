"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { useTranslations } from "next-intl";
import { DropdownItem, DropdownMenu, DropdownTrigger } from "@nextui-org/react";
import {
	Add01Icon,
	ArrowDown01Icon,
	ArrowUpRight01Icon,
	BookBookmark01Icon,
	Cancel01Icon,
	Search01Icon,
	SortingAZ01Icon,
	SquareLock01Icon,
	Tick02Icon,
	TimeQuarterPassIcon,
} from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Dropdown } from "@/components/nextui/Dropdown";
import { Input } from "@/components/nextui/Input";
import { Tooltip } from "@/components/nextui/Tooltip";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { toast } from "@/components/layout/Toast";
import { ReaderAvatar, readerDisplayName } from "@/components/layout/navbar/UserMenu";
import { CoverStack } from "@/components/features/collections/CoverStack";
import { ListPager } from "@/components/features/collections/ListPager";
import { MemberFaces } from "@/components/features/collections/CollectionPeople";
import { useDebounce } from "@/hooks/useDebounce";
import { useReaderData } from "@/hooks/useReaderData";
import { Link } from "@/i18n/routing";
import { twMerge } from "@/lib/tw-merge";
import { READER_COLLECTION_NAME_LIMIT } from "@/db/schema/tables/reader";
import type { CollectionsPage, PickerCollection } from "@/lib/readers/data";
import { PICKER_COLLECTIONS_PER_PAGE, pickerCollectionsKey } from "@/lib/readers/collection-pages";
import { fetcher } from "@/lib/utils";

type Sort = "recent" | "name";

const SORT_ICONS = { recent: TimeQuarterPassIcon, name: SortingAZ01Icon } as const;

/**
 * A page of the collections a record can go into, read from the server: the reader's own, newest first, then the ones
 * shared with them that they edit, or all of them by name. While the next page is on its way, the last one stays.
 */
function usePickerPage(itemKey: string | undefined, search: string, sort: Sort, page: number) {
	const { reader } = useReaderData();
	const viewer = reader?.id ?? null;
	const { data, isLoading } = useSWR<CollectionsPage<PickerCollection>>(reader ? pickerCollectionsKey({ viewer, search, sort, page, itemKey }) : null, fetcher, {
		keepPreviousData: true,
		revalidateOnFocus: false,
	});
	// The page the picker opened on says how many collections there are to choose from, which sizes the list whatever a search finds.
	const { data: first } = useSWR<CollectionsPage<PickerCollection>>(reader ? firstPickerPageKey(viewer, itemKey) : null, fetcher, { revalidateOnFocus: false });
	const choices = first?.total ?? 0;
	const { rows, pages, total, page: served } = data ?? { rows: [], pages: 1, total: 0, page };
	return {
		loaded: data !== undefined,
		rows,
		waiting: isLoading,
		openedWith: Math.min(choices, PICKER_COLLECTIONS_PER_PAGE),
		paged: choices > PICKER_COLLECTIONS_PER_PAGE,
		// While the asked page is on its way, the pager already shows it.
		pager: { page: isLoading ? page : served, pages, total },
	};
}

const firstPickerPageKey = (viewer: string | null, itemKey: string | undefined) => pickerCollectionsKey({ viewer, search: "", sort: "recent", page: 1, itemKey });

/** First pages being read ahead, so reaching for a button and then pressing it read the page once. */
const readingAhead = new Map<string, Promise<void>>();

/**
 * Reads the picker's first page ahead as the reader reaches for the button that opens it, and opens the picker once
 * that page is in, so it opens with its rows. A failed read opens it anyway, and the picker reads the page again.
 */
export function usePickerAhead(itemKey: string | undefined) {
	const { reader } = useReaderData();
	const { cache, mutate } = useSWRConfig();
	const key = firstPickerPageKey(reader?.id ?? null, itemKey);
	// Into the cache, so the picker's first frame has it; the picker reads it again as it opens.
	const read = () => {
		if (cache.get(key)?.data) return Promise.resolve();
		const reading =
			readingAhead.get(key) ??
			mutate(key, fetcher(key), { revalidate: false })
				.then(
					() => undefined,
					() => undefined,
				)
				.finally(() => readingAhead.delete(key));
		readingAhead.set(key, reading);
		return reading;
	};
	return { warm: () => void read(), open: (open: () => void) => void read().then(open) };
}

async function post(path: string, body: object) {
	const response = await fetch(`/api${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return (await response.json()) as { id?: string };
}

/**
 * Where a record goes into collections: a search and a sort, a row that makes
 * a new collection with the record already in it, then the collections a page
 * at a time from the server. Each row toggles the record in or out and has its
 * own button to open the collection.
 */
export function CollectionPicker({
	itemKey,
	onToggle,
}: {
	/** The record; until it is known the rows can't be pressed. */
	itemKey: string | undefined;
	/** Puts the record in a collection or takes it out, told whether the collection held it. */
	onToggle: (collectionId: string, heldRecord: boolean) => Promise<void>;
}) {
	const t = useTranslations("ui");
	const { refresh } = useReaderData();
	const [sort, setSort] = useState<Sort>("recent");
	const [page, setPage] = useState(1);
	const query = usePickerSearch(() => setPage(1));
	const { draft, search } = query;
	// Collections made here since the picker opened, which slide open.
	const [made, setMade] = useState<ReadonlySet<string>>(new Set());
	const { pending, toggle } = usePendingToggles(onToggle);
	const shown = usePickerPage(itemKey, search, sort, page);

	// Only making the collection can fail the row: once it exists, the row closes whatever else fails, so it isn't made twice.
	const create = async (name: string) => {
		const created = await post("/reader/collections", { name, description: null, private: true });
		const id = created.id;
		if (id) setMade((ids) => new Set(ids).add(id));
		if (itemKey && id) await post(`/reader/collections/${id}/items`, { itemKey }).catch(() => toast({ type: "error", title: t("collectionSaveFailed") }));
		query.clear();
		setSort("recent");
		setPage(1);
		await refresh().catch((error: unknown) => console.error("Reloading the reader's collections failed", error));
	};

	return (
		<div className="flex flex-col gap-4">
			<PickerControls
				search={draft}
				onSearch={query.type}
				sort={sort}
				onSort={setSort}
			/>
			{/* It opens to its height once the first page is in, if the picker opened before it. */}
			<div className={twMerge("grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none", shown.loaded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
				<div className="min-h-0 overflow-hidden">
					<ul className="flex flex-col">
						<NewCollectionRow initialName={draft.trim()} onCreate={create} disabled={!itemKey} />
						{/* As many rows as it opened with, or one for a search's answer, so what a search finds never shrinks it. */}
						<li className="flex flex-col" style={{ minHeight: `${Math.max(shown.openedWith, draft.trim() ? 1 : 0) * 4}rem` }}>
							<ul inert={shown.waiting || undefined} className={twMerge("flex flex-col transition-opacity duration-150 motion-reduce:transition-none", shown.waiting && "opacity-50")}>
								{shown.rows.map((collection) => (
									<PickerRow
										key={collection.id}
										collection={collection}
										entering={made.has(collection.id)}
										pending={pending.has(collection.id)}
										disabled={!itemKey}
										onToggle={() => void toggle(collection.id, collection.holdsRecord)}
									/>
								))}
								<NothingFound total={shown.loaded ? shown.pager.total : undefined} search={search} />
							</ul>
						</li>
					</ul>
				</div>
			</div>
			{/* The pages keep their place while a search finds only one. */}
			{shown.paged ? (
				<div className="h-8">
					<ListPager {...shown.pager} perPage={PICKER_COLLECTIONS_PER_PAGE} onChange={setPage} />
				</div>
			) : null}
		</div>
	);
}

/** What the reader types in the search, and the search the server is asked for once they pause, which starts from page one. */
function usePickerSearch(onSearch: () => void) {
	const [draft, setDraft] = useState("");
	const [search, setSearch] = useState("");
	const [searchSoon, , cancelSearch] = useDebounce((value: string) => {
		setSearch(value);
		onSearch();
	}, 250);
	return {
		draft,
		search,
		type: (value: string) => {
			setDraft(value);
			searchSoon(value);
		},
		clear: () => {
			cancelSearch();
			setDraft("");
			setSearch("");
		},
	};
}

/** Toggling the record in a collection, one row at a time: each row waits for its own change, and a failed one says so. */
function usePendingToggles(onToggle: (collectionId: string, heldRecord: boolean) => Promise<void>) {
	const t = useTranslations("ui");
	const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
	const toggle = async (collectionId: string, heldRecord: boolean) => {
		setPending((set) => new Set(set).add(collectionId));
		try {
			await onToggle(collectionId, heldRecord);
		} catch (error) {
			console.error(error);
			toast({ type: "error", title: t("collectionSaveFailed") });
		} finally {
			setPending((set) => {
				const next = new Set(set);
				next.delete(collectionId);
				return next;
			});
		}
	};
	return { pending, toggle };
}

/** Said in place of the rows when a search found none of the reader's collections. */
function NothingFound({ total, search }: { total: number | undefined; search: string }) {
	const t = useTranslations("ui");
	if (total !== 0 || !search.trim()) return null;
	return <li className="flex h-16 items-center px-3 text-small text-black/50 dark:text-white/50">{t("noMatchingCollections")}</li>;
}

/** The search, and the sort beside it. */
function PickerControls({ search, onSearch, sort, onSort }: { search: string; onSearch: (value: string) => void; sort: Sort; onSort: (sort: Sort) => void }) {
	const t = useTranslations("ui");
	const sortLabel = (option: Sort) => (option === "recent" ? t("sortRecent") : t("sortName"));
	return (
		<div className="flex gap-2">
			<Input
				aria-label={t("searchCollections")}
				placeholder={t("searchCollections")}
				value={search}
				onValueChange={onSearch}
				isClearable
				startContent={<HugeiconsIcon icon={Search01Icon} className="size-5 shrink-0 text-black/40 dark:text-white/40" aria-hidden />}
				classNames={{ base: "flex-1" }}
			/>
			<Dropdown placement="bottom-end">
				<DropdownTrigger>
					<Button
						aria-label={t("sortCollections", { sort: sortLabel(sort) })}
						startContent={<HugeiconsIcon icon={SORT_ICONS[sort]} className="size-5 shrink-0" aria-hidden />}
						endContent={<HugeiconsIcon icon={ArrowDown01Icon} className="size-4 opacity-60" aria-hidden />}
						className="h-auto min-w-0 shrink-0 gap-2 self-stretch px-3 font-medium"
					>
						{/* On a phone the icon says it, so the search keeps its width. */}
						<span className="max-sm:hidden">{sortLabel(sort)}</span>
					</Button>
				</DropdownTrigger>
				<DropdownMenu aria-label={t("sortCollections", { sort: "" })} onAction={(key) => onSort(key as Sort)}>
					{(["recent", "name"] as const).map((option) => (
						<DropdownItem
							key={option}
							startContent={<HugeiconsIcon icon={SORT_ICONS[option]} className="size-5 shrink-0" aria-hidden />}
							endContent={option === sort ? <HugeiconsIcon icon={Tick02Icon} className="size-4 shrink-0 text-accent" aria-hidden /> : null}
						>
							{sortLabel(option)}
						</DropdownItem>
					))}
				</DropdownMenu>
			</Dropdown>
		</div>
	);
}

/**
 * The first row: New collection, which becomes a name field in place. The
 * collection is made private, as one made on the profile is, with the record
 * already in it.
 */
function NewCollectionRow({
	initialName,
	onCreate,
	disabled,
}: {
	initialName: string;
	onCreate: (name: string) => Promise<void>;
	/** The record isn't known yet, so a collection can't be made with it in. */
	disabled: boolean;
}) {
	const t = useTranslations("ui");
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState("");
	const [saving, setSaving] = useState(false);
	const tile = (
		<span aria-hidden className="flex h-[3.25rem] w-[4.5rem] shrink-0 items-center justify-center">
			<span className="flex aspect-[3/4] w-9 items-center justify-center rounded-md border-2 border-dashed border-accent/50 text-accent">
				<HugeiconsIcon icon={Add01Icon} className="size-4" />
			</span>
		</span>
	);
	if (!editing) {
		return (
			<li>
				<button
					type="button"
					disabled={disabled}
					// What the reader searched for and didn't find is the name they likely want.
					onClick={() => {
						setName(initialName.slice(0, READER_COLLECTION_NAME_LIMIT));
						setEditing(true);
					}}
					className="flex h-16 w-full items-center gap-3 rounded-xl px-2 text-start font-medium text-accent outline-none hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default dark:hover:bg-white/[0.06]"
				>
					{tile}
					{t("newCollection")}
				</button>
			</li>
		);
	}
	const trimmed = name.trim();
	return (
		<li>
			<form
				className="flex h-16 items-center gap-3 px-2"
				onSubmit={(event) => {
					event.preventDefault();
					if (!trimmed || saving) return;
					setSaving(true);
					void onCreate(trimmed)
						.then(() => {
							setEditing(false);
							setName("");
						})
						.catch((error: unknown) => {
							console.error(error);
							toast({ type: "error", title: t("collectionSaveFailed") });
						})
						.finally(() => setSaving(false));
				}}
			>
				{tile}
				<Input
					autoFocus
					aria-label={t("collectionNameLabel")}
					placeholder={t("collectionNameLabel")}
					maxLength={READER_COLLECTION_NAME_LIMIT}
					value={name}
					onValueChange={setName}
					onKeyDown={(event) => {
						// Escape leaves the name field, not the whole dialog.
						if (event.key !== "Escape") return;
						event.stopPropagation();
						setEditing(false);
					}}
					classNames={{ base: "flex-1", inputWrapper: "h-10 min-h-10" }}
				/>
				<Button type="submit" color="accent" isDisabled={!trimmed} isLoading={saving} className="h-10 shrink-0 px-4 font-medium">
					{t("create")}
				</Button>
				<Tooltip content={t("cancel")}>
					<Button isIconOnly variant="transparent" aria-label={t("cancel")} onPress={() => setEditing(false)} className="h-10 w-10 shrink-0">
						<HugeiconsIcon icon={Cancel01Icon} className="size-5" aria-hidden />
					</Button>
				</Tooltip>
			</form>
		</li>
	);
}

/**
 * One collection: its covers, name and what's in it, then a check the whole
 * row toggles, and a button that opens the collection. A collection shared
 * with the reader shows its owner instead of who it is shared with.
 */
function PickerRow({
	collection,
	entering,
	pending,
	disabled,
	onToggle,
}: {
	collection: PickerCollection;
	entering: boolean;
	pending: boolean;
	disabled: boolean;
	onToggle: () => void;
}) {
	const t = useTranslations("ui");
	const { ownerId, owner, holdsRecord: checked } = collection;
	return (
		<li className={twMerge("grid grid-rows-[1fr]", entering && "animate-row-open motion-reduce:animate-none")}>
			<div className="flex h-16 min-h-0 items-center gap-1 overflow-hidden">
				<button
					type="button"
					aria-pressed={checked}
					disabled={disabled || pending}
					onClick={onToggle}
					className="group flex h-full min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-start outline-none hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default dark:hover:bg-white/[0.06]"
				>
					<CoverStack userId={ownerId} collectionId={collection.id} count={collection.count} fanned={false} size="sm" />
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="flex min-w-0 items-center gap-1.5">
							<TruncatedText text={collection.name} className="font-medium text-black/85 dark:text-white/85" />
							{collection.private ? (
								<HugeiconsIcon icon={SquareLock01Icon} className="size-4 shrink-0 opacity-60" aria-label={t("privateCollection")} />
							) : null}
						</span>
						<span className="flex min-w-0 items-center gap-3 text-small text-black/50 dark:text-white/50">
							<span className="flex shrink-0 items-center gap-1 tabular-nums">
								<HugeiconsIcon icon={BookBookmark01Icon} className="size-3.5" aria-hidden />
								{t("collectionRecordCount", { count: collection.count })}
							</span>
							{owner ? (
								<span className="flex min-w-0 items-center gap-1.5">
									<ReaderAvatar reader={owner} size="sm" className="h-5 w-5 shrink-0 text-[9px]" aria-hidden />
									<span className="truncate">{readerDisplayName(owner, t)}</span>
								</span>
							) : (
								<MemberFaces members={collection.members} />
							)}
						</span>
					</span>
					<span
						aria-hidden
						className={twMerge(
							"flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-150",
							checked ? "border-accent bg-accent text-white" : "border-black/20 text-transparent group-hover:border-black/40 dark:border-white/25 dark:group-hover:border-white/45",
							pending && "animate-pulse",
						)}
					>
						<HugeiconsIcon icon={Tick02Icon} className="size-3.5" strokeWidth={3} />
					</span>
				</button>
				<Tooltip content={t("openCollection")}>
					<Button
						as={Link}
						href={`/profile/${ownerId}?collectionId=${collection.id}`}
						isIconOnly
						variant="transparent"
						aria-label={t("openCollection")}
						className="h-10 w-10 shrink-0"
					>
						<HugeiconsIcon icon={ArrowUpRight01Icon} className="size-5" aria-hidden />
					</Button>
				</Tooltip>
			</div>
		</li>
	);
}
