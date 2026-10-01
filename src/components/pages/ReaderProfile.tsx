"use client";

import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { useFormatter, useTranslations } from "next-intl";
import { SelectItem } from "@nextui-org/react";
import {
	Add01Icon,
	Bookmark02Icon,
	CollectionsBookmarkIcon,
	LockIcon,
	Share08Icon,
	Tick02Icon,
	UserEdit01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Input } from "@/components/nextui/Input";
import { Select } from "@/components/nextui/Select";
import { useClipboardFeedback } from "@/hooks/useClipboardFeedback";
import { useItemsList } from "@/hooks/useItemsList";
import { buildItemsQuery, fetcher } from "@/lib/utils";
import { twMerge } from "@/lib/tw-merge";
import type { ItemsGetResponse } from "@/app/api/items/types";
import ItemsList from "@/components/features/items/ItemsList";
import { PdfCover } from "@/components/features/items/PdfCover";
import { useLibraryFeature } from "@/context/LibraryConfigProvider";
import { OPENSCHOLAR_ACCOUNT_URL, useMockReaderSession } from "@/components/layout/navbar/MockReaderSession";
import { ReaderAvatar, readerDisplayName } from "@/components/layout/navbar/UserMenu";
import PageContainer from "@/components/layout/PageContainer";

type ProfileCollection = {
	id: string;
	name: string;
	description?: string | null;
	private?: boolean | null;
	numItems?: number | null;
};

type ProfileData = {
	id: string;
	name?: string | null;
	image?: string | null;
	likes: Record<string, unknown>;
	collections: ProfileCollection[];
};

function useShelfItems(userId: string, collectionId: string) {
	const query = buildItemsQuery(collectionId ? { collectionId, page: 1 } : { page: 1 }, `/user/items/${userId}`);
	return useSWR<ItemsGetResponse>(query, fetcher, { revalidateOnFocus: false, keepPreviousData: true });
}

/**
 * A reader's page: their card on top, then their bookmarks the way the
 * library lists records, with search and sort, and their collections beside
 * it where the library keeps its filters.
 */
export default function ReaderProfile({ data }: { data: ProfileData }) {
	const t = useTranslations("ui");
	const { reader } = useMockReaderSession();
	const isOwnProfile = reader?.id === data.id;
	const collectionsEnabled = useLibraryFeature("userCollections");
	const items = useItemsList(data);
	// MOCK ONLY: a new collection is kept on the page until phase 2 wires the
	// endpoint to the new session.
	const [createdCollections, setCreatedCollections] = useState<ProfileCollection[]>([]);
	const collections = collectionsEnabled ? [...data.collections, ...createdCollections] : [];
	const profileReader = { id: data.id, name: data.name ?? "", image: data.image ?? null };
	const bookmarkCount = Object.keys(data.likes).length;
	const bookmarkDates = Object.values(data.likes).map((value) => new Date(value as string)).filter((date) => !Number.isNaN(date.getTime()));
	const firstBookmarkedAt = bookmarkDates.length > 0 ? new Date(Math.min(...bookmarkDates.map((date) => date.getTime()))) : null;
	const selected = items.queryParams.collectionId || "";
	const shelves = [
		{ id: "", name: t("allBookmarks"), count: bookmarkCount, isPrivate: false },
		...collections.map((collection) => ({
			id: collection.id,
			name: collection.name,
			count: collection.numItems ?? 0,
			isPrivate: Boolean(collection.private),
		})),
	];
	const select = (id: string) => items.handleCollectionSelect(id);

	return (
		<PageContainer id="main-content" className="flex w-full flex-col gap-8 xl:gap-10">
			<ProfileHeader
				reader={profileReader}
				userId={data.id}
				isOwnProfile={isOwnProfile}
				bookmarkCount={bookmarkCount}
				collectionCount={collectionsEnabled ? collections.length : null}
				firstBookmarkedAt={firstBookmarkedAt}
			/>
			<div className="flex flex-col gap-8 lg:flex-row xl:gap-10">
				{collectionsEnabled ? (
					<CollectionsNav
						shelves={shelves}
						selected={selected}
						onSelect={select}
						footer={
							isOwnProfile ? (
								<NewCollection onCreate={(collection) => setCreatedCollections((previous) => [...previous, collection])} />
							) : null
						}
					/>
				) : null}
				<div className="flex min-w-0 flex-1 flex-col gap-4">
					<ItemsList
						props={items}
						header={shelves.find((shelf) => shelf.id === selected)?.name ?? t("allBookmarks")}
						userData={{ ...data, collections }}
						extraFilters={
							collectionsEnabled ? (
								<Select
									aria-label={t("bookmarksListAriaLabel")}
									color="secondary"
									placement="left"
									className="lg:hidden"
									disallowEmptySelection
									selectedKeys={[selected || "all"]}
									onSelectionChange={(keys) => {
										const key = String(Array.from(keys)[0] ?? "all");
										select(key === "all" ? "" : key);
									}}
									startContent={
										<HugeiconsIcon icon={selected ? CollectionsBookmarkIcon : Bookmark02Icon} className="size-5 shrink-0" aria-hidden />
									}
								>
									{shelves.map((shelf) => (
										<SelectItem key={shelf.id || "all"} textValue={shelf.name}>
											{shelf.name}
										</SelectItem>
									))}
								</Select>
							) : null
						}
					/>
				</div>
			</div>
		</PageContainer>
	);
}

/**
 * The reader's bookmarks and collections, in the column the library uses for
 * its filters. Choosing one lists its records beside it.
 */
function CollectionsNav({
	shelves,
	selected,
	onSelect,
	footer,
}: {
	shelves: { id: string; name: string; count: number; isPrivate: boolean }[];
	selected: string;
	onSelect: (id: string) => void;
	footer: ReactNode;
}) {
	const t = useTranslations("ui");
	const format = useFormatter();
	return (
		<aside id="collections" aria-label={t("bookmarksListAriaLabel")} className="hidden w-full shrink-0 lg:block lg:w-[24rem] xl:w-[28.5rem]">
			<nav className="flex flex-col gap-1 rounded-2xl bg-[#E8E6E1] p-4 dark:bg-secondary">
				<h2 className="px-3 pb-2 pt-2 text-lg font-medium text-black/80 dark:text-white/80">{t("collections")}</h2>
				{shelves.map((shelf) => {
					const isSelected = shelf.id === selected;
					return (
						<button
							key={shelf.id || "all"}
							type="button"
							aria-current={isSelected || undefined}
							onClick={() => onSelect(shelf.id)}
							className={twMerge(
								"flex h-12 items-center gap-3 rounded-xl px-3 text-start text-black/70 outline-none hover:bg-black/[0.05] focus-visible:ring-2 focus-visible:ring-accent dark:text-white/70 dark:hover:bg-white/[0.06]",
								isSelected && "bg-white font-medium text-black hover:bg-white dark:bg-white/10 dark:text-white dark:hover:bg-white/10",
							)}
						>
							<HugeiconsIcon
								icon={shelf.id ? CollectionsBookmarkIcon : Bookmark02Icon}
								className={twMerge("size-5 shrink-0", isSelected && "text-accent")}
								aria-hidden
							/>
							<span className="min-w-0 flex-1 truncate">{shelf.name}</span>
							{shelf.isPrivate ? (
								<HugeiconsIcon icon={LockIcon} className="size-4 shrink-0 opacity-60" aria-label={t("privateCollection")} />
							) : null}
							<span className="shrink-0 text-small tabular-nums opacity-60">{format.number(shelf.count)}</span>
						</button>
					);
				})}
				{footer ? <div className="px-1 pt-3">{footer}</div> : null}
			</nav>
		</aside>
	);
}

function ProfileHeader({
	reader,
	userId,
	isOwnProfile,
	bookmarkCount,
	collectionCount,
	firstBookmarkedAt,
}: {
	reader: { id: string; name: string; image: string | null };
	userId: string;
	isOwnProfile: boolean;
	bookmarkCount: number;
	collectionCount: number | null;
	firstBookmarkedAt: Date | null;
}) {
	const t = useTranslations("ui");
	const format = useFormatter();
	const { copy, copied } = useClipboardFeedback();
	const stats = [
		{ key: "bookmarks", value: format.number(bookmarkCount), label: t("bookmarksStat", { count: bookmarkCount }) },
		...(collectionCount === null
			? []
			: [{ key: "collections", value: format.number(collectionCount), label: t("collectionsStat", { count: collectionCount }) }]),
		...(firstBookmarkedAt
			? [{ key: "first", value: format.dateTime(firstBookmarkedAt, { month: "short", year: "numeric" }), label: t("firstBookmarkStat") }]
			: []),
	];

	return (
		<header className="overflow-hidden rounded-2xl bg-white dark:bg-secondary">
			<CoverWall userId={userId} bookmarkCount={bookmarkCount} />
			<div className="flex flex-col gap-6 px-5 pb-6 sm:px-8 sm:pb-8 lg:flex-row lg:items-end lg:justify-between">
				<div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
					{/* The ring is the card's own colour, so the avatar reads as cut out of the covers behind it. */}
					<span className="relative -mt-14 w-fit shrink-0 rounded-full bg-white p-1.5 sm:-mt-16 dark:bg-secondary">
						<ReaderAvatar reader={reader} size="lg" className="h-24 w-24 text-3xl sm:h-28 sm:w-28 [&_svg]:size-10" />
					</span>
					<div className="flex min-w-0 flex-col gap-3">
						<h1 className="truncate font-heading text-4xl font-semibold tracking-tight text-foreground sm:text-5xl dark:text-white">
							{readerDisplayName(reader, t)}
						</h1>
						<dl className="flex flex-wrap gap-x-8 gap-y-2">
							{stats.map((stat) => (
								<div key={stat.key} className="flex flex-row-reverse items-baseline justify-end gap-1.5">
									<dt className="text-small text-foreground/60 dark:text-white/60">{stat.label}</dt>
									<dd className="text-lg font-semibold tabular-nums text-foreground dark:text-white">{stat.value}</dd>
								</div>
							))}
						</dl>
					</div>
				</div>
				<div className="flex shrink-0 flex-wrap gap-2">
					<Button
						onPress={() => copy(`${window.location.origin}${window.location.pathname}`)}
						startContent={<HugeiconsIcon icon={copied ? Tick02Icon : Share08Icon} className="size-5" aria-hidden />}
						className="h-10 px-4 font-medium"
					>
						{copied ? t("profileLinkCopied") : t("shareProfile")}
					</Button>
					{isOwnProfile ? (
						<Button
							as="a"
							href={OPENSCHOLAR_ACCOUNT_URL}
							target="_blank"
							rel="noopener"
							startContent={<HugeiconsIcon icon={UserEdit01Icon} className="size-5" aria-hidden />}
							className="h-10 px-4 font-medium"
						>
							{reader.name.trim() ? t("editProfile") : t("addYourName")}
						</Button>
					) : null}
				</div>
			</div>
		</header>
	);
}

/** Enough covers to run past the widest card, repeating a short list. */
const WALL_SIZE = 16;

/**
 * The reader's bookmarks as a wall of cover pages across the top of their card,
 * in the order the shelf below shows them. It is a picture of what they read,
 * so it is hidden from assistive technology; the shelves carry the records.
 * The band has a fixed height, so the covers arriving moves nothing.
 */
function CoverWall({ userId, bookmarkCount }: { userId: string; bookmarkCount: number }) {
	const { data } = useShelfItems(userId, "");
	const records = data?.items ?? [];
	const wall = records.length > 0 ? Array.from({ length: WALL_SIZE }, (_, index) => records[index % records.length]!) : [];
	return (
		<div aria-hidden className="relative h-40 overflow-hidden bg-accent/10 sm:h-52">
			{bookmarkCount > 0 ? (
				<ul className="absolute inset-x-0 -top-6 flex gap-4 px-4">
					{(data ? wall : Array.from({ length: WALL_SIZE }, () => null)).map((record, index) => (
						<li
							key={index}
							className="w-28 shrink-0 sm:w-32"
							style={{ transform: `translateY(${index % 2 ? 28 : 0}px) rotate(${index % 3 === 0 ? -3 : index % 3 === 1 ? 2 : -1}deg)` }}
						>
							{record ? (
								<PdfCover
									src={record.attachmentsData?.find((attachment) => attachment.PDFCoverPageImage)?.PDFCoverPageImage}
									alt=""
									title={record.title ?? undefined}
									className="aspect-[3/4] w-full object-cover shadow-md"
									width={128}
								/>
							) : (
								<div className="aspect-[3/4] rounded-xl bg-black/[0.05] dark:bg-white/[0.06]" />
							)}
						</li>
					))}
				</ul>
			) : null}
			{/* The covers fade into the card where the name begins. */}
			<div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-white dark:from-secondary" />
		</div>
	);
}

function NewCollection({ onCreate }: { onCreate: (collection: ProfileCollection) => void }) {
	const t = useTranslations("ui");
	const [draftName, setDraftName] = useState<string | null>(null);
	if (draftName === null) {
		return (
			<Button
				onPress={() => setDraftName("")}
				startContent={<HugeiconsIcon icon={Add01Icon} className="size-5" aria-hidden />}
				className="h-10 w-fit px-4 font-medium"
			>
				{t("newCollection")}
			</Button>
		);
	}
	return (
		<form
			className="flex flex-wrap gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				const name = draftName.trim();
				if (!name) return;
				onCreate({ id: `mock-${name}`, name, numItems: 0, private: true });
				setDraftName(null);
			}}
		>
			<Input
				autoFocus
				aria-label={t("collectionNameLabel")}
				placeholder={t("collectionNameLabel")}
				value={draftName}
				onValueChange={setDraftName}
				classNames={{ base: "max-w-sm" }}
			/>
			<Button type="submit" color="accent" className="h-10 px-4 font-medium">
				{t("create")}
			</Button>
			<Button onPress={() => setDraftName(null)} className="h-10 px-4">
				{t("cancel")}
			</Button>
		</form>
	);
}
