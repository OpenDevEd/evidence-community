"use client";

import { use, useState } from "react";
import useSWR from "swr";
import { useFormatter, useTranslations } from "next-intl";
import {
	Add01Icon,
	ArrowLeft01Icon,
	ArrowRight01Icon,
	LockIcon,
	Share08Icon,
	Tick02Icon,
	UserEdit01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Input } from "@/components/nextui/Input";
import { ItemsContext } from "@/context/ItemsContext";
import { useClipboardFeedback } from "@/hooks/useClipboardFeedback";
import { useItemsList } from "@/hooks/useItemsList";
import { Link } from "@/i18n/routing";
import { buildItemsQuery, fetcher } from "@/lib/utils";
import { twMerge } from "@/lib/tw-merge";
import type { ItemsGetResponse } from "@/app/api/items/types";
import type { ListItem } from "@/app/api/item/types";
import { SearchBar } from "@/components/features/SearchBar";
import { SortComponent } from "@/components/features/resources/LibrarySearchSelects";
import { PaginationControls } from "@/components/features/resources/ResourcesView";
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

/**
 * Record types keep one colour on every card, validated for both themes
 * (dataviz palette, slots 1 to 5). A type outside the first four shares the
 * last colour.
 */
const TYPE_COLOURS = [
	{ type: "Report", className: "bg-[#2a78d6] dark:bg-[#3987e5]" },
	{ type: "JournalArticle", className: "bg-[#eb6834] dark:bg-[#d95926]" },
	{ type: "Book", className: "bg-[#1baf7a] dark:bg-[#199e70]" },
	{ type: "Dataset", className: "bg-[#eda100] dark:bg-[#c98500]" },
] as const;
const OTHER_COLOUR = "bg-[#e87ba4] dark:bg-[#d55181]";

function typeColour(type: string | undefined) {
	return TYPE_COLOURS.find((entry) => entry.type === type)?.className ?? OTHER_COLOUR;
}

function useShelfItems(userId: string, collectionId: string) {
	const query = buildItemsQuery(collectionId ? { collectionId, page: 1 } : { page: 1 }, `/user/items/${userId}`);
	return useSWR<ItemsGetResponse>(query, fetcher, { revalidateOnFocus: false, keepPreviousData: true });
}

/**
 * A reader's page as shelves: who they are and what their bookmarks are made
 * of, then one shelf for all bookmarks and one per collection. "See all" opens
 * a shelf as a full list with its own search and sort.
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
	const [openShelf, setOpenShelf] = useState<string | null>(items.queryParams.collectionId ? items.queryParams.collectionId : null);
	const profileReader = { id: data.id, name: data.name ?? "", image: data.image ?? null };
	const bookmarkCount = Object.keys(data.likes).length;
	const bookmarkDates = Object.values(data.likes).map((value) => new Date(value as string)).filter((date) => !Number.isNaN(date.getTime()));
	const firstBookmarkedAt = bookmarkDates.length > 0 ? new Date(Math.min(...bookmarkDates.map((date) => date.getTime()))) : null;

	const open = (shelf: string | null) => {
		setOpenShelf(shelf);
		items.handleCollectionSelect(shelf && shelf !== "all" ? shelf : "");
		window.scrollTo({ top: 0 });
	};

	const openCollection = collections.find((collection) => collection.id === openShelf);

	return (
		<ItemsContext.Provider value={items}>
			<PageContainer id="main-content" className="flex w-full flex-col gap-10">
				{openShelf ? (
					<section className="flex flex-col gap-6">
						<div className="flex flex-col gap-2">
							<button
								type="button"
								onClick={() => open(null)}
								className="flex w-fit items-center gap-1.5 text-small font-medium text-foreground/60 hover:text-foreground dark:text-white/60 dark:hover:text-white"
							>
								<HugeiconsIcon icon={ArrowLeft01Icon} className="size-4 rtl:rotate-180" aria-hidden />
								{readerDisplayName(profileReader, t)}
							</button>
							<h1 className="flex items-center gap-2 font-heading text-3xl font-semibold text-foreground dark:text-white">
								{openCollection ? openCollection.name : t("allBookmarks")}
								{openCollection?.private ? (
									<HugeiconsIcon icon={LockIcon} className="size-5 text-foreground/50 dark:text-white/50" aria-label={t("privateCollection")} />
								) : null}
							</h1>
							{openCollection?.description ? (
								<p className="text-foreground/60 dark:text-white/60">{openCollection.description}</p>
							) : null}
						</div>
						<FullShelf />
					</section>
				) : (
					<>
						<ProfileHeader
							reader={profileReader}
							userId={data.id}
							isOwnProfile={isOwnProfile}
							bookmarkCount={bookmarkCount}
							collectionCount={collectionsEnabled ? collections.length : null}
							firstBookmarkedAt={firstBookmarkedAt}
						/>
						{bookmarkCount === 0 ? (
							<EmptyShelves isOwnProfile={isOwnProfile} />
						) : (
							<div className="flex flex-col gap-10">
								<Shelf userId={data.id} title={t("allBookmarks")} count={bookmarkCount} onSeeAll={() => open("all")} />
								{collections.map((collection) => (
									<Shelf
										key={collection.id}
										userId={data.id}
										collectionId={collection.id}
										title={collection.name}
										description={collection.description}
										isPrivate={Boolean(collection.private)}
										count={collection.numItems ?? 0}
										onSeeAll={() => open(collection.id)}
									/>
								))}
								{collectionsEnabled && isOwnProfile ? (
									<NewCollection onCreate={(collection) => setCreatedCollections((previous) => [...previous, collection])} />
								) : null}
							</div>
						)}
					</>
				)}
			</PageContainer>
		</ItemsContext.Provider>
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

function Shelf({
	userId,
	collectionId = "",
	title,
	description,
	isPrivate = false,
	count,
	onSeeAll,
}: {
	userId: string;
	collectionId?: string;
	title: string;
	description?: string | null;
	isPrivate?: boolean;
	count: number;
	onSeeAll: () => void;
}) {
	const t = useTranslations("ui");
	const { data } = useShelfItems(userId, collectionId);
	const records = data?.items ?? [];
	// The shelf keeps its height while its records load, so nothing below moves.
	const placeholders = Math.min(count, 6);

	return (
		<section className="flex flex-col gap-4">
			<div className="flex items-end justify-between gap-4">
				<div className="min-w-0">
					<h2 className="flex items-center gap-2 text-xl font-semibold text-foreground dark:text-white">
						<span className="truncate">{title}</span>
						{isPrivate ? (
							<HugeiconsIcon icon={LockIcon} className="size-4 shrink-0 text-foreground/50 dark:text-white/50" aria-label={t("privateCollection")} />
						) : null}
						<span className="rounded-full bg-black/[0.06] px-2 text-small font-medium tabular-nums text-foreground/70 dark:bg-white/10 dark:text-white/70">
							{count}
						</span>
					</h2>
					{description ? <p className="truncate text-small text-foreground/60 dark:text-white/60">{description}</p> : null}
				</div>
				{count > 0 ? (
					<button
						type="button"
						onClick={onSeeAll}
						className="flex shrink-0 items-center gap-1 text-small font-medium text-accent hover:underline"
					>
						{t("seeAll")}
						<HugeiconsIcon icon={ArrowRight01Icon} className="size-4 rtl:rotate-180" aria-hidden />
					</button>
				) : null}
			</div>
			{count === 0 ? (
				<p className="rounded-2xl bg-black/[0.03] px-5 py-6 text-small text-foreground/60 dark:bg-white/[0.04] dark:text-white/60">
					{t("emptyCollectionBody")}
				</p>
			) : (
				<ul className="no-scrollbar -mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2">
					{data
						? records.map((record) => (
								<li key={record.key} className="w-40 shrink-0 snap-start sm:w-44">
									<RecordCard record={record} />
								</li>
							))
						: Array.from({ length: placeholders }, (_, index) => (
								<li key={index} className="w-40 shrink-0 sm:w-44" aria-hidden>
									<div className="aspect-[3/4] rounded-xl bg-black/[0.05] dark:bg-white/[0.06]" />
									<div className="mt-3 h-[4.75rem]" />
								</li>
							))}
				</ul>
			)}
		</section>
	);
}

function RecordCard({ record }: { record: ListItem }) {
	const tTypes = useTranslations("itemType");
	const cover = record.attachmentsData?.find((attachment) => attachment.PDFCoverPageImage)?.PDFCoverPageImage;
	const firstCreator = record.creators?.[0] as { lastName?: string; name?: string } | undefined;
	const author = firstCreator?.lastName || firstCreator?.name || null;
	return (
		<Link href={`/lib/${record.key}`} className="group flex flex-col gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent">
			<div className="overflow-hidden rounded-xl shadow-sm transition-shadow group-hover:shadow-md">
				<PdfCover src={cover} alt="" title={record.title ?? undefined} className="aspect-[3/4] w-full object-cover" width={176} />
			</div>
			<div className="flex flex-col gap-1">
				<span className="flex items-center gap-2 text-tiny font-medium text-foreground/60 dark:text-white/60">
					<span aria-hidden className={twMerge("h-1.5 w-3 rounded-full", typeColour(record.itemType))} />
					{tTypes(record.itemType)}
				</span>
				<span className="line-clamp-2 text-small font-medium leading-snug text-foreground group-hover:text-accent dark:text-white">
					{record.title}
				</span>
				<span className="truncate text-tiny text-foreground/50 dark:text-white/50">
					{[author, record.year].filter(Boolean).join(", ")}
				</span>
			</div>
		</Link>
	);
}

/** One shelf opened as the full list: its own search and sort, then the library's record rows. */
function FullShelf() {
	const items = use(ItemsContext);
	const t = useTranslations("ui");
	return (
		<section className="flex flex-col gap-6">
			<div className="flex flex-col gap-3 sm:flex-row">
				<div className="min-w-0 flex-1">
					<SearchBar handleSearchChange={items.handleSearchChange} search={items.queryParams.search || ""} />
				</div>
				<div className="sm:w-56 sm:shrink-0">
					<SortComponent itemsContext={items} />
				</div>
			</div>
			{items.itemsData && items.itemsData.items.length === 0 ? (
				<p className="py-12 text-center text-foreground/60 dark:text-white/60">{t("noResourcesFound")}</p>
			) : (
				<ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
					{(items.itemsData?.items ?? []).map((record: ListItem) => (
						<li key={record.key}>
							<RecordCard record={record} />
						</li>
					))}
				</ul>
			)}
			<PaginationControls />
		</section>
	);
}

function EmptyShelves({ isOwnProfile }: { isOwnProfile: boolean }) {
	const t = useTranslations("ui");
	return (
		<section className="flex flex-col items-center gap-4 rounded-3xl bg-white px-6 py-16 text-center dark:bg-secondary">
			<div className="flex gap-3" aria-hidden>
				{[0, 1, 2].map((index) => (
					<div
						key={index}
						className={twMerge(
							"aspect-[3/4] w-16 rounded-lg border-2 border-dashed border-black/10 dark:border-white/15",
							index === 1 && "-translate-y-2",
						)}
					/>
				))}
			</div>
			<h2 className="text-xl font-semibold text-foreground dark:text-white">{t("noBookmarksTitle")}</h2>
			<p className="max-w-md text-foreground/60 dark:text-white/60">
				{isOwnProfile ? t("noBookmarksBody") : t("noBookmarksOther")}
			</p>
			{isOwnProfile ? (
				<Button as={Link} href="/lib" color="accent" className="mt-2 h-10 px-5 font-medium">
					{t("browseLibrary")}
				</Button>
			) : null}
		</section>
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
