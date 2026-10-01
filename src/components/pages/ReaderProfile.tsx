"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { useFormatter, useTranslations } from "next-intl";
import { ModalBody, ModalContent, ModalFooter, SelectItem } from "@nextui-org/react";
import {
	Add01Icon,
	Bookmark02Icon,
	CollectionsBookmarkIcon,
	Delete02Icon,
	PencilEdit01Icon,
	Share08Icon,
	SquareLock01Icon,
	Tick02Icon,
	UserEdit01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { ConfirmationModal } from "@/components/nextui/ConfirmationModal";
import DialogModal from "@/components/nextui/DialogModal";
import { Input } from "@/components/nextui/Input";
import { Select } from "@/components/nextui/Select";
import { Switch } from "@/components/nextui/Switch";
import { Textarea } from "@/components/nextui/Textarea";
import { Tooltip } from "@/components/nextui/Tooltip";
import GenericHeader from "@/components/features/modals/GenericHeader";
import { useClipboardFeedback } from "@/hooks/useClipboardFeedback";
import { LIST_TOP_ID } from "@/hooks/useFilters";
import { useItemsList } from "@/hooks/useItemsList";
import { buildItemsQuery, fetcher } from "@/lib/utils";
import { twMerge } from "@/lib/tw-merge";
import type { ItemsGetResponse } from "@/app/api/items/types";
import ItemsList from "@/components/features/items/ItemsList";
import { PdfCover } from "@/components/features/items/PdfCover";
import { useOpenScholarAccountUrl, useReaderSession } from "@/components/layout/navbar/ReaderSession";
import { useReaderData } from "@/hooks/useReaderData";
import type { ReaderCollectionSummary } from "@/lib/readers/data";
import { ReaderAvatar, readerDisplayName } from "@/components/layout/navbar/UserMenu";
import PageContainer from "@/components/layout/PageContainer";

type ProfileCollection = ReaderCollectionSummary;
type CollectionInput = { name: string; description: string | null; private: boolean };

/** What anyone may see of a reader: never their email, and private collections only for themselves. */
export type ProfileData = {
	id: string;
	name: string;
	image: string | null;
	bookmarks: Record<string, string>;
	collections: ProfileCollection[];
};

async function sendCollectionChange(url: string, method: "POST" | "PATCH" | "DELETE", body?: CollectionInput) {
	const response = await fetch(`/api${url}`, {
		method,
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!response.ok) throw new Error(`Collection change failed with HTTP ${response.status}`);
}

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
	const { reader } = useReaderSession();
	const isOwnProfile = reader?.id === data.id;
	const items = useItemsList(data);
	const router = useRouter();
	const { mutate: refreshReaderData } = useReaderData();
	const { mutate } = useSWRConfig();
	const collections = data.collections;
	const [dialog, setDialog] = useState<{ collection: ProfileCollection | null } | null>(null);
	const profileReader = { id: data.id, name: data.name, image: data.image };
	const bookmarkCount = Object.keys(data.bookmarks).length;
	const bookmarkDates = Object.values(data.bookmarks).map((value) => new Date(value)).filter((date) => !Number.isNaN(date.getTime()));
	const firstBookmarkedAt = bookmarkDates.length > 0 ? new Date(Math.min(...bookmarkDates.map((date) => date.getTime()))) : null;
	const selected = items.queryParams.collectionId || "";
	const shelves = [
		{ id: "", name: t("allBookmarks"), count: bookmarkCount, isPrivate: false, description: null },
		...collections.map((collection) => ({
			id: collection.id,
			name: collection.name,
			count: collection.count,
			isPrivate: Boolean(collection.private),
			description: collection.description ?? null,
		})),
	];
	const select = (id: string) => items.handleCollectionSelect(id);
	const selectedCollection = collections.find((collection) => collection.id === selected);
	// The profile's data comes with the page, so a change reloads it, along with
	// the reader's own controls and the lists already shown.
	const refresh = async () => {
		router.refresh();
		await Promise.all([
			refreshReaderData(),
			mutate((key) => typeof key === "string" && key.startsWith(`/user/items/${data.id}`)),
		]);
	};
	const save = async (id: string | null, input: CollectionInput) => {
		await sendCollectionChange(id ? `/reader/collections/${id}` : "/reader/collections", id ? "PATCH" : "POST", input);
		await refresh();
	};
	const edit = (id: string) => setDialog({ collection: collections.find((collection) => collection.id === id) ?? null });
	const remove = async (id: string) => {
		await sendCollectionChange(`/reader/collections/${id}`, "DELETE");
		if (selected === id) select("");
		await refresh();
	};

	return (
		<PageContainer id="main-content" className="flex w-full flex-col gap-8 xl:gap-10">
			<ProfileHeader
				reader={profileReader}
				userId={data.id}
				isOwnProfile={isOwnProfile}
				bookmarkCount={bookmarkCount}
				collectionCount={collections.length}
				firstBookmarkedAt={firstBookmarkedAt}
			/>
			<div id={LIST_TOP_ID} className="flex scroll-mt-6 flex-col gap-8 lg:flex-row xl:gap-10">
				<CollectionsNav
					userId={data.id}
					shelves={shelves}
					selected={selected}
					onSelect={select}
					onEdit={isOwnProfile ? edit : undefined}
					onCreate={isOwnProfile ? () => setDialog({ collection: null }) : undefined}
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-4">
					<ItemsList
						props={items}
						header={selectedCollection?.name ?? t("allBookmarks")}
						userData={{ ...data, collections }}
						extraFilters={
							(
								<div className="flex gap-2 lg:hidden">
									<Select
										aria-label={t("bookmarksListAriaLabel")}
										color="secondary"
										placement="left"
										className="max-w-full flex-1"
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
											<SelectItem key={shelf.id || "all"} textValue={shelf.name} description={shelf.description}>
												{shelf.name}
											</SelectItem>
										))}
									</Select>
									{isOwnProfile && selectedCollection ? (
										<Tooltip content={t("editCollection")}>
											<Button
												isIconOnly
												aria-label={t("editCollection")}
												onPress={() => edit(selectedCollection.id)}
												className="h-12 w-12 shrink-0"
											>
												<HugeiconsIcon icon={PencilEdit01Icon} className="size-5" aria-hidden />
											</Button>
										</Tooltip>
									) : null}
									{isOwnProfile ? (
										<Tooltip content={t("newCollection")}>
											<Button
												isIconOnly
												aria-label={t("newCollection")}
												onPress={() => setDialog({ collection: null })}
												className="h-12 w-12 shrink-0"
											>
												<HugeiconsIcon icon={Add01Icon} className="size-5" aria-hidden />
											</Button>
										</Tooltip>
									) : null}
								</div>
							)
						}
					/>
				</div>
			</div>
			{dialog ? (
				<CollectionDialog
					key={dialog.collection?.id ?? "new"}
					collection={dialog.collection}
					onClose={() => setDialog(null)}
					onSave={save}
					onDelete={remove}
				/>
			) : null}
		</PageContainer>
	);
}

/**
 * Creates a collection or edits one: its name, description and whether only
 * its owner sees it. A new collection starts private, since the profile it
 * appears on is public. Deleting asks first; the bookmarks stay bookmarked.
 */
function CollectionDialog({
	collection,
	onClose,
	onSave,
	onDelete,
}: {
	collection: ProfileCollection | null;
	onClose: () => void;
	onSave: (id: string | null, input: CollectionInput) => Promise<void>;
	onDelete: (id: string) => Promise<void>;
}) {
	const t = useTranslations("ui");
	const [name, setName] = useState(collection?.name ?? "");
	const [description, setDescription] = useState(collection?.description ?? "");
	const [isPrivate, setIsPrivate] = useState(collection ? collection.private : true);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [saving, setSaving] = useState(false);
	const [failed, setFailed] = useState(false);
	const trimmedName = name.trim();
	const run = async (change: () => Promise<void>) => {
		setSaving(true);
		setFailed(false);
		try {
			await change();
			onClose();
		} catch (error) {
			console.error(error);
			setFailed(true);
			setConfirmingDelete(false);
		} finally {
			setSaving(false);
		}
	};

	return (
		<>
			<DialogModal size="md" isOpen={!confirmingDelete} onOpenChange={(open) => !open && onClose()}>
				<ModalContent>
					<GenericHeader onClose={onClose}>{collection ? t("editCollection") : t("newCollection")}</GenericHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (!trimmedName || saving) return;
							void run(() =>
								onSave(collection?.id ?? null, {
									name: trimmedName,
									description: description.trim() || null,
									private: isPrivate,
								}),
							);
						}}
					>
						<ModalBody className="gap-4 pt-0">
							<Input
								autoFocus
								isRequired
								label={t("collectionNameLabel")}
								labelPlacement="outside"
								placeholder={t("collectionNameLabel")}
								maxLength={24}
								value={name}
								onValueChange={setName}
							/>
							<Textarea
								label={t("collectionDescriptionLabel")}
								labelPlacement="outside"
								placeholder={t("collectionDescriptionLabel")}
								maxLength={200}
								minRows={3}
								value={description}
								onValueChange={setDescription}
							/>
							<Switch
								color="accent"
								isSelected={isPrivate}
								onValueChange={setIsPrivate}
								classNames={{
									base: "h-auto w-full max-w-full justify-between gap-4 rounded-xl bg-black/[0.04] px-4 py-3 dark:bg-white/[0.06]",
									label: "flex flex-col gap-0.5 text-start",
								}}
							>
								<span className="text-small font-medium text-black/80 dark:text-white/80">{t("privateCollection")}</span>
								<span className="text-small font-normal text-black/60 dark:text-white/60">{t("collectionVisibilityPrivateDescription")}</span>
							</Switch>
							{failed ? (
								<p role="alert" className="text-small text-danger">
									{t("collectionSaveFailed")}
								</p>
							) : null}
						</ModalBody>
						<ModalFooter className="gap-2 pb-6">
							{collection ? (
								<Button
									variant="transparent"
									onPress={() => setConfirmingDelete(true)}
									startContent={<HugeiconsIcon icon={Delete02Icon} className="size-5" aria-hidden />}
									className="me-auto h-10 px-3 font-medium text-danger dark:text-danger"
								>
									{t("deleteAction")}
								</Button>
							) : null}
							<Button variant="transparent" onPress={onClose} className="h-10 px-4 font-medium">
								{t("cancel")}
							</Button>
							<Button type="submit" color="accent" isDisabled={!trimmedName} isLoading={saving} className="h-10 px-4 font-medium">
								{collection ? t("save") : t("create")}
							</Button>
						</ModalFooter>
					</form>
				</ModalContent>
			</DialogModal>
			{collection ? (
				<ConfirmationModal
					isOpen={confirmingDelete}
					onOpenChange={(open) => !open && setConfirmingDelete(false)}
					title={t("deleteCollectionTitle", { name: collection.name })}
					description={t("deleteCollectionBody")}
					confirmLabel={t("deleteAction")}
					cancelLabel={t("cancel")}
					onConfirm={() => void run(() => onDelete(collection.id))}
				/>
			) : null}
		</>
	);
}

/**
 * The reader's bookmarks and collections, in the column the library uses for
 * its filters, each shown as a small stack of its own records. Choosing one
 * lists its records beside it, fans its stack out and opens the row to show
 * what it is for and, for its owner, a way to edit it.
 */
function CollectionsNav({
	userId,
	shelves,
	selected,
	onSelect,
	onEdit,
	onCreate,
}: {
	userId: string;
	shelves: { id: string; name: string; count: number; isPrivate: boolean; description: string | null }[];
	selected: string;
	onSelect: (id: string) => void;
	/** Only the owner edits their collections. */
	onEdit?: (id: string) => void;
	/** Only the owner adds collections. */
	onCreate?: () => void;
}) {
	const t = useTranslations("ui");
	const format = useFormatter();
	return (
		<aside id="collections" aria-label={t("bookmarksListAriaLabel")} className="hidden w-full shrink-0 lg:block lg:w-[24rem] xl:w-[28.5rem]">
			{/* The same card as the profile's own, its head tinted like the cover band above. */}
			<nav className="overflow-hidden rounded-2xl bg-white dark:bg-secondary">
				<div className="flex items-center justify-between gap-3 bg-accent/10 px-5 py-4">
					<h2 className="flex items-center gap-2.5 font-heading text-xl font-semibold tracking-tight text-foreground dark:text-white">
						{t("collections")}
						<span className="rounded-full bg-white px-2 text-small font-medium tabular-nums text-black/70 dark:bg-white/10 dark:text-white/70">
							{format.number(shelves.length - 1)}
						</span>
					</h2>
					{onCreate ? (
						<Button
							color="accent"
							onPress={onCreate}
							startContent={<HugeiconsIcon icon={Add01Icon} className="size-5" aria-hidden />}
							className="h-10 shrink-0 px-4 font-medium"
						>
							{t("newCollection")}
						</Button>
					) : null}
				</div>
				<div className="flex flex-col gap-1 p-3">
				{shelves.map((shelf) => {
					const isSelected = shelf.id === selected;
					const isOpen = isSelected && Boolean(shelf.id) && Boolean(shelf.description || onEdit);
					return (
						<div key={shelf.id || "all"} className={twMerge("rounded-xl", isSelected && "bg-black/[0.04] dark:bg-white/[0.06]")}>
							<button
								type="button"
								aria-current={isSelected || undefined}
								onClick={() => onSelect(shelf.id)}
								className={twMerge(
									"group flex w-full items-center gap-4 rounded-xl p-3 text-start text-black/80 outline-none hover:bg-black/[0.05] focus-visible:ring-2 focus-visible:ring-accent dark:text-white/80 dark:hover:bg-white/[0.06]",
									isSelected && "text-black hover:bg-transparent dark:text-white dark:hover:bg-transparent",
								)}
							>
								<CoverStack userId={userId} collectionId={shelf.id} count={shelf.count} fanned={isSelected} />
								<span className="flex min-w-0 flex-1 flex-col gap-0.5">
									<span className="flex min-w-0 items-center gap-1.5">
										<span className={twMerge("truncate font-medium", isSelected && "font-semibold")}>{shelf.name}</span>
										{shelf.isPrivate ? (
											<HugeiconsIcon icon={SquareLock01Icon} className="size-4 shrink-0 opacity-60" aria-label={t("privateCollection")} />
										) : null}
									</span>
									<span className="text-small text-black/50 dark:text-white/50">{t("collectionRecordCount", { count: shelf.count })}</span>
								</span>
							</button>
							{/* The row opens to its full height, so the rows below slide down instead of jumping. */}
							<div
								inert={!isOpen || undefined}
								className={twMerge(
									"grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
									isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
								)}
							>
								<div className="min-h-0 overflow-hidden">
									<div className="flex flex-col items-start gap-3 px-3 pb-3">
										{shelf.description ? (
											<p className="text-small leading-relaxed text-black/60 dark:text-white/60">{shelf.description}</p>
										) : null}
										{onEdit ? (
											<Button
												onPress={() => onEdit(shelf.id)}
												startContent={<HugeiconsIcon icon={PencilEdit01Icon} className="size-4" aria-hidden />}
												className="h-8 min-w-0 gap-1.5 bg-black/[0.05] px-3 text-small font-medium dark:bg-white/10"
											>
												{t("editAction")}
											</Button>
										) : null}
									</div>
								</div>
							</div>
						</div>
					);
				})}
				</div>
			</nav>
		</aside>
	);
}

/** Where each of the three covers sits, closed and fanned out: [x in px, rotation in degrees]. */
const STACK_POSES = [
	{ closed: [0, 0], fanned: [0, 0] },
	{ closed: [-12, -8], fanned: [-22, -14] },
	{ closed: [12, 8], fanned: [22, 14] },
] as const;

/**
 * A collection's first three records as a little stack of cover pages, the
 * first in front. A chosen collection fans its stack out. An empty one shows
 * an outline where its first record will go. The box has a fixed size, so the
 * covers arriving moves nothing.
 */
function CoverStack({ userId, collectionId, count, fanned }: { userId: string; collectionId: string; count: number; fanned: boolean }) {
	const { data } = useShelfItems(userId, collectionId);
	const records = data?.items.slice(0, 3) ?? [];
	const slots = Math.min(count, 3);
	return (
		<span aria-hidden className="relative h-[4.5rem] w-24 shrink-0">
			{count === 0 ? (
				<span className="absolute start-1/2 top-1 aspect-[3/4] w-12 -translate-x-1/2 rounded-md border-2 border-dashed border-black/15 rtl:translate-x-1/2 dark:border-white/20" />
			) : (
				Array.from({ length: slots }, (_, index) => slots - 1 - index).map((index) => {
					const record = records[index];
					const [x, rotation] = STACK_POSES[index]![fanned ? "fanned" : "closed"];
					return (
						<span
							key={index}
							className="absolute start-1/2 top-1 -ms-6 w-12 transition-transform duration-300 ease-out group-hover:[--lift:-2px] motion-reduce:transition-none"
							style={{ transform: `translate(${x}px, var(--lift, 0px)) rotate(${rotation}deg)` }}
						>
							{record ? (
								<PdfCover
									src={record.attachmentsData?.find((attachment) => attachment.PDFCoverPageImage)?.PDFCoverPageImage}
									alt=""
									title={record.title ?? undefined}
									className="aspect-[3/4] w-full rounded-md object-cover shadow-[0_1px_3px_rgba(0,0,0,0.18)]"
									width={48}
								/>
							) : (
								<span className="block aspect-[3/4] w-full rounded-md bg-black/[0.08] dark:bg-white/10" />
							)}
						</span>
					);
				})
			)}
		</span>
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
	const accountUrl = useOpenScholarAccountUrl();
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
							href={accountUrl}
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
