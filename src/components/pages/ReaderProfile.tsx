"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { ModalBody, ModalContent, ModalFooter, SelectItem, SelectSection } from "@nextui-org/react";
import {
	Add01Icon,
	Bookmark02Icon,
	CollectionsBookmarkIcon,
	Delete02Icon,
	Logout01Icon,
	PencilEdit01Icon,
	Share08Icon,
	SquareLock01Icon,
	Tick02Icon,
	UserAdd01Icon,
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
import { Skeleton } from "@/components/nextui/Skeleton";
import GenericHeader from "@/components/features/modals/GenericHeader";
import { useClipboardFeedback } from "@/hooks/useClipboardFeedback";
import { LIST_TOP_ID } from "@/hooks/useFilters";
import { useItemsList } from "@/hooks/useItemsList";
import { twMerge } from "@/lib/tw-merge";
import ItemsList from "@/components/features/items/ItemsList";
import { PdfCover } from "@/components/features/items/PdfCover";
import { useOpenScholarAccountUrl, useReaderSession } from "@/components/layout/navbar/ReaderSession";
import { useReaderData } from "@/hooks/useReaderData";
import type { CollectionAccess, CollectionMember, ReaderCollectionSummary, SharedCollectionSummary } from "@/lib/readers/data";
import { Link } from "@/i18n/routing";
import { MemberFaces, RoleChip, ShareCollectionDialog, useSentInvitations } from "@/components/features/collections/CollectionPeople";
import { CoverStack, useShelfItems } from "@/components/features/collections/CoverStack";
import { ListPager, pageOf, pageWith } from "@/components/features/collections/ListPager";
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
	return response.status === 201 ? ((await response.json()) as { id: string }) : null;
}

/** Which collection the owner is editing, or a new one; nothing for visitors. */
function useCollectionDialog(isOwnProfile: boolean, collections: ProfileCollection[]) {
	const [dialog, setDialog] = useState<{ collection: ProfileCollection | null } | null>(null);
	if (!isOwnProfile) return { dialog: null, edit: undefined, create: undefined, close: () => setDialog(null) };
	return {
		dialog,
		edit: (id: string) => setDialog({ collection: collections.find((collection) => collection.id === id) ?? null }),
		create: () => setDialog({ collection: null }),
		close: () => setDialog(null),
	};
}

/**
 * A reader's page: their card on top, then their bookmarks the way the
 * library lists records, with search and sort, and their collections beside
 * it where the library keeps its filters.
 */
type Shelf = {
	id: string;
	name: string;
	count: number;
	isPrivate: boolean;
	description: string | null;
	access: CollectionAccess;
	members: CollectionMember[];
};

/** All bookmarks first, then each collection, as the column and the phone picker list them. */
function profileShelves(allBookmarks: string, bookmarkCount: number, collections: ProfileCollection[]): Shelf[] {
	return [
		{ id: "", name: allBookmarks, count: bookmarkCount, isPrivate: false, description: null, access: null, members: [] },
		...collections.map((collection) => ({
			id: collection.id,
			name: collection.name,
			count: collection.count,
			isPrivate: collection.private,
			description: collection.description,
			access: collection.access,
			members: collection.members,
		})),
	];
}

function firstBookmarkDate(bookmarks: Record<string, string>) {
	const times = Object.values(bookmarks).map((value) => new Date(value).getTime()).filter((time) => !Number.isNaN(time));
	return times.length > 0 ? new Date(Math.min(...times)) : null;
}

/**
 * Saving and deleting the owner's collections. The profile's data comes with
 * the page, so a change reloads it, along with the reader's own controls and
 * the lists already shown.
 */
function useCollectionChanges(selected: string, select: (id: string) => void) {
	const router = useRouter();
	const { refresh: refreshReaderData } = useReaderData();
	const refresh = async () => {
		router.refresh();
		await refreshReaderData();
	};
	return {
		save: async (id: string | null, input: CollectionInput) => {
			const made = await sendCollectionChange(id ? `/reader/collections/${id}` : "/reader/collections", id ? "PATCH" : "POST", input);
			await refresh();
			// A new collection opens at once, which also turns the column to the page it is on.
			if (made) select(made.id);
		},
		remove: async (id: string) => {
			await sendCollectionChange(`/reader/collections/${id}`, "DELETE");
			if (selected === id) select("");
			await refresh();
		},
	};
}

/**
 * The owner sees their own collections and bookmarks live, so a change made
 * from a record shows here at once, and the collections others shared with
 * them below. Anyone else sees the public collections the page brought and
 * the private ones shared with them, even when the page was made for the
 * owner before they signed out. Who a collection is shared with shows only to
 * its members.
 */
function useShownShelves(data: ProfileData, isOwnProfile: boolean, viewerId: string | null) {
	const { data: own } = useReaderData();
	if (!isOwnProfile) {
		const collections = data.collections.flatMap((collection) => {
			const role = collection.members.find((member) => member.id === viewerId)?.role ?? null;
			if (collection.private && !role) return [];
			return [{ ...collection, access: role, members: role ? collection.members : [] }];
		});
		return { collections, shared: [], bookmarks: data.bookmarks };
	}
	return { collections: own?.collections ?? data.collections, shared: own?.shared ?? [], bookmarks: own?.bookmarks ?? data.bookmarks };
}

/** Leaving a collection someone shared with the reader, after asking. */
function useLeaveCollection(selected: string, select: (id: string) => void) {
	const router = useRouter();
	const { reader, refresh } = useReaderData();
	const [leaving, setLeaving] = useState<Shelf | null>(null);
	return {
		leaving,
		ask: setLeaving,
		cancel: () => setLeaving(null),
		leave: async () => {
			if (!leaving || !reader) return;
			await sendCollectionChange(`/reader/collections/${leaving.id}/members/${reader.id}`, "DELETE");
			if (selected === leaving.id) select("");
			setLeaving(null);
			router.refresh();
			await refresh();
		},
	};
}

/**
 * A reader's page: their card on top, then their bookmarks the way the
 * library lists records, with search and sort, and their collections beside
 * it where the library keeps its filters.
 */
export default function ReaderProfile({
	data,
	loading = false,
}: {
	data: ProfileData;
	/** Drawn while the profile is on its way, from its address alone: the reader, their counts and collections show as placeholders. */
	loading?: boolean;
}) {
	const t = useTranslations("ui");
	const { reader } = useReaderSession();
	const isOwnProfile = reader?.id === data.id;
	const items = useItemsList(data);
	const { collections, shared, bookmarks } = useShownShelves(data, isOwnProfile, reader?.id ?? null);
	const { data: sent } = useSentInvitations(isOwnProfile);
	const [sharing, setSharing] = useState<string | null>(null);
	const sharedCollection = collections.find((collection) => collection.id === sharing);
	const bookmarkCount = Object.keys(bookmarks).length;
	const selected = items.queryParams.collectionId || "";
	const shelves = profileShelves(t("allBookmarks"), bookmarkCount, collections);
	const select = (id: string) => items.handleCollectionSelect(id);
	const selectedCollection = collections.find((collection) => collection.id === selected);
	const { save, remove } = useCollectionChanges(selected, select);
	const { dialog, edit, create, close } = useCollectionDialog(isOwnProfile, collections);
	const leaving = useLeaveCollection(selected, select);
	const onShare = isOwnProfile ? setSharing : undefined;
	const onLeave = (id: string) => {
		const shelf = shelves.find((candidate) => candidate.id === id);
		if (shelf) leaving.ask(shelf);
	};

	return (
		<PageContainer id="main-content" className="flex w-full flex-col gap-8 xl:gap-10">
			<ProfileHeader
				reader={{ id: data.id, name: data.name, image: data.image }}
				userId={data.id}
				isOwnProfile={isOwnProfile}
				loading={loading}
				bookmarkCount={bookmarkCount}
				collectionCount={collections.length}
				firstBookmarkedAt={firstBookmarkDate(bookmarks)}
			/>
			<div id={LIST_TOP_ID} className="flex scroll-mt-6 flex-col gap-8 lg:flex-row xl:gap-10">
				<CollectionsNav
					userId={data.id}
					loading={loading}
					shelves={shelves}
					shared={shared}
					selected={selected}
					onSelect={select}
					onEdit={edit}
					onCreate={create}
					onShare={onShare}
					onLeave={onLeave}
				/>
				<div className="flex min-w-0 flex-1 flex-col gap-4">
					<ItemsList
						props={items}
						header={selectedCollection?.name ?? t("allBookmarks")}
						userData={{ ...data, collections }}
						extraFilters={
							<PhoneCollectionPicker
								shelves={shelves}
								shared={shared}
								selected={selected}
								onSelect={select}
								onEdit={edit}
								onCreate={create}
								onShare={onShare}
								onLeave={onLeave}
							/>
						}
					/>
				</div>
			</div>
			{dialog ? (
				<CollectionDialog
					key={dialog.collection?.id ?? "new"}
					collection={dialog.collection}
					onClose={close}
					onSave={save}
					onDelete={remove}
				/>
			) : null}
			{sharedCollection ? (
				<ShareCollectionDialog collection={sharedCollection} invitations={sent?.invitations} onClose={() => setSharing(null)} />
			) : null}
			{leaving.leaving ? (
				<ConfirmationModal
					isOpen
					onOpenChange={(open) => !open && leaving.cancel()}
					title={t("leaveCollectionTitle", { name: leaving.leaving.name })}
					description={t("leaveCollectionBody", { owner: readerDisplayName(data, t) })}
					confirmLabel={t("leaveCollection")}
					cancelLabel={t("cancel")}
					onConfirm={() => void leaving.leave()}
				/>
			) : null}
		</PageContainer>
	);
}

/** On phones the column is hidden, so a picker beside the filters chooses the list and the owner's actions sit next to it. */
function PhoneCollectionPicker({
	shelves,
	shared,
	selected,
	onSelect,
	onEdit,
	onCreate,
	onShare,
	onLeave,
}: {
	shelves: Shelf[];
	/** On the reader's own profile, the collections shared with them; choosing one opens it on its owner's profile. */
	shared: SharedCollectionSummary[];
	selected: string;
	onSelect: (id: string) => void;
	/** The owner edits the collection the picker shows. */
	onEdit?: (id: string) => void;
	onCreate?: () => void;
	onShare?: (id: string) => void;
	onLeave: (id: string) => void;
}) {
	const t = useTranslations("ui");
	const router = useRouter();
	const shown = shelves.find((shelf) => shelf.id === selected);
	const isMember = shown?.access === "editor" || shown?.access === "viewer";
	return (
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
					const other = shared.find((collection) => collection.id === key);
					if (other) router.push(`/profile/${other.owner.id}?collectionId=${other.id}`);
					else onSelect(key === "all" ? "" : key);
				}}
				startContent={<HugeiconsIcon icon={selected ? CollectionsBookmarkIcon : Bookmark02Icon} className="size-5 shrink-0" aria-hidden />}
			>
				<SelectSection showDivider={shared.length > 0}>
					{shelves.map((shelf) => (
						<SelectItem key={shelf.id || "all"} textValue={shelf.name} description={shelf.description}>
							{shelf.name}
						</SelectItem>
					))}
				</SelectSection>
				<SelectSection title={shared.length > 0 ? t("sharedWithYou") : undefined}>
					{shared.map((collection) => (
						<SelectItem
							key={collection.id}
							textValue={collection.name}
							description={readerDisplayName(collection.owner, t)}
							startContent={<ReaderAvatar reader={collection.owner} size="sm" className="h-6 w-6 text-[10px]" aria-hidden />}
						>
							{collection.name}
						</SelectItem>
					))}
				</SelectSection>
			</Select>
			{onShare && selected ? (
				<Tooltip content={t("shareAction")}>
					<Button isIconOnly aria-label={t("shareAction")} onPress={() => onShare(selected)} className="h-12 w-12 shrink-0">
						<HugeiconsIcon icon={UserAdd01Icon} className="size-5" aria-hidden />
					</Button>
				</Tooltip>
			) : null}
			{isMember ? (
				<Tooltip content={t("leaveCollection")}>
					<Button isIconOnly aria-label={t("leaveCollection")} onPress={() => onLeave(selected)} className="h-12 w-12 shrink-0">
						<HugeiconsIcon icon={Logout01Icon} className="size-5" aria-hidden />
					</Button>
				</Tooltip>
			) : null}
			{onEdit && selected ? (
				<Tooltip content={t("editCollection")}>
					<Button isIconOnly aria-label={t("editCollection")} onPress={() => onEdit(selected)} className="h-12 w-12 shrink-0">
						<HugeiconsIcon icon={PencilEdit01Icon} className="size-5" aria-hidden />
					</Button>
				</Tooltip>
			) : null}
			{onCreate ? (
				<Tooltip content={t("newCollection")}>
					<Button isIconOnly aria-label={t("newCollection")} onPress={onCreate} className="h-12 w-12 shrink-0">
						<HugeiconsIcon icon={Add01Icon} className="size-5" aria-hidden />
					</Button>
				</Tooltip>
			) : null}
		</div>
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
						<CollectionFields
							name={name}
							description={description}
							isPrivate={isPrivate}
							failed={failed}
							onName={setName}
							onDescription={setDescription}
							onPrivate={setIsPrivate}
						/>
						<CollectionDialogActions
							canDelete={Boolean(collection)}
							canSave={Boolean(trimmedName)}
							saving={saving}
							saveLabel={collection ? t("save") : t("create")}
							onDelete={() => setConfirmingDelete(true)}
							onCancel={onClose}
						/>
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

/** The collection's name, description and privacy, and a note when saving failed. */
function CollectionFields(props: {
	name: string;
	description: string;
	isPrivate: boolean;
	failed: boolean;
	onName: (value: string) => void;
	onDescription: (value: string) => void;
	onPrivate: (value: boolean) => void;
}) {
	const t = useTranslations("ui");
	return (
		<ModalBody className="gap-4 pt-0">
			<Input
				autoFocus
				isRequired
				label={t("collectionNameLabel")}
				labelPlacement="outside"
				placeholder={t("collectionNameLabel")}
				maxLength={24}
				value={props.name}
				onValueChange={props.onName}
			/>
			<Textarea
				label={t("collectionDescriptionLabel")}
				labelPlacement="outside"
				placeholder={t("collectionDescriptionLabel")}
				maxLength={200}
				minRows={3}
				value={props.description}
				onValueChange={props.onDescription}
			/>
			<Switch
				color="accent"
				isSelected={props.isPrivate}
				onValueChange={props.onPrivate}
				classNames={{
					base: "h-auto w-full max-w-full justify-between gap-4 rounded-xl bg-black/[0.04] px-4 py-3 dark:bg-white/[0.06]",
					label: "flex flex-col gap-0.5 text-start",
				}}
			>
				<span className="text-small font-medium text-black/80 dark:text-white/80">{t("privateCollection")}</span>
				<span className="text-small font-normal text-black/60 dark:text-white/60">{t("collectionVisibilityPrivateDescription")}</span>
			</Switch>
			{props.failed ? (
				<p role="alert" className="text-small text-danger">
					{t("collectionSaveFailed")}
				</p>
			) : null}
		</ModalBody>
	);
}

/** Delete on the start side for an existing collection, then Cancel and the save button. */
function CollectionDialogActions({
	canDelete,
	canSave,
	saving,
	saveLabel,
	onDelete,
	onCancel,
}: {
	canDelete: boolean;
	canSave: boolean;
	saving: boolean;
	saveLabel: string;
	onDelete: () => void;
	onCancel: () => void;
}) {
	const t = useTranslations("ui");
	return (
		<ModalFooter className="gap-2 pb-6">
			{canDelete ? (
				<Button
					variant="transparent"
					onPress={onDelete}
					startContent={<HugeiconsIcon icon={Delete02Icon} className="size-5" aria-hidden />}
					className="me-auto h-10 px-3 font-medium text-danger dark:text-danger"
				>
					{t("deleteAction")}
				</Button>
			) : null}
			<Button variant="transparent" onPress={onCancel} className="h-10 px-4 font-medium">
				{t("cancel")}
			</Button>
			<Button type="submit" color="accent" isDisabled={!canSave} isLoading={saving} className="h-10 px-4 font-medium">
				{saveLabel}
			</Button>
		</ModalFooter>
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
	loading,
	shelves,
	shared,
	selected,
	onSelect,
	onEdit,
	onCreate,
	onShare,
	onLeave,
}: {
	userId: string;
	/** The reader's collections are not known yet: their count and rows show as placeholders. */
	loading: boolean;
	shelves: Shelf[];
	/** On the reader's own profile, the collections others shared with them. */
	shared: SharedCollectionSummary[];
	selected: string;
	onSelect: (id: string) => void;
	/** Only the owner edits their collections. */
	onEdit?: (id: string) => void;
	/** Only the owner adds collections. */
	onCreate?: () => void;
	/** Only the owner shares their collections. */
	onShare?: (id: string) => void;
	/** A member leaves a collection shared with them. */
	onLeave: (id: string) => void;
}) {
	const t = useTranslations("ui");
	const format = useFormatter();
	const [all, ...collections] = shelves;
	const page = useFollowingPage(collections, selected);
	const { pages, current, shown } = pageOf(collections, page.number, COLLECTIONS_PER_PAGE);
	return (
		<aside id="collections" aria-label={t("bookmarksListAriaLabel")} className="hidden w-full shrink-0 lg:block lg:w-[24rem] xl:w-[28.5rem]">
			{/* The same card as the profile's own, its head tinted like the cover band above. */}
			<nav className="overflow-hidden rounded-2xl bg-white dark:bg-secondary">
				<div className="flex items-center justify-between gap-3 bg-accent/10 px-5 py-4">
					<h2 className="flex items-center gap-2.5 font-heading text-xl font-semibold tracking-tight text-foreground dark:text-white">
						{t("collections")}
						{loading ? (
							<Skeleton className="h-5 w-7 rounded-full" />
						) : (
							<span className="rounded-full bg-white px-2 text-small font-medium tabular-nums text-black/70 dark:bg-white/10 dark:text-white/70">
								{format.number(shelves.length - 1)}
							</span>
						)}
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
					{loading ? (
						// One row, as tall as a row with its cover stack. The reader's collections are not known yet, so no page follows it.
						<Skeleton className="h-24 rounded-xl" />
					) : all ? (
						<CollectionRow userId={userId} shelf={all} isSelected={selected === ""} onSelect={() => onSelect("")} />
					) : null}
					{/* A page keeps a full page's height, so turning to a shorter last page moves nothing below. */}
					<div className="flex flex-col gap-1" style={{ minHeight: pages > 1 ? COLLECTIONS_PAGE_HEIGHT : undefined }}>
						{shown.map((shelf) => (
							<CollectionRow
								key={shelf.id}
								userId={userId}
								shelf={shelf}
								isSelected={shelf.id === selected}
								onSelect={() => onSelect(shelf.id)}
								onEdit={onEdit ? () => onEdit(shelf.id) : undefined}
								onShare={onShare ? () => onShare(shelf.id) : undefined}
								onLeave={() => onLeave(shelf.id)}
							/>
						))}
					</div>
					<div className="px-2 pt-2 empty:hidden">
						<ListPager page={current} pages={pages} total={collections.length} perPage={COLLECTIONS_PER_PAGE} onChange={page.turn} />
					</div>
				</div>
				{shared.length > 0 ? <SharedWithYou collections={shared} /> : null}
			</nav>
		</aside>
	);
}

/** Collections on one page of the profile's column. */
const COLLECTIONS_PER_PAGE = 6;
/** That many rows (a cover stack and its padding, 6rem) with the gaps between them. */
const COLLECTIONS_PAGE_HEIGHT = `calc(${COLLECTIONS_PER_PAGE} * 6rem + ${COLLECTIONS_PER_PAGE - 1} * 0.25rem)`;

/**
 * The page of the column to show. It is the page the chosen collection is
 * on, so one chosen from elsewhere (a link, the record picker, a collection
 * just made) is in view, until the reader turns to another page. Choosing a
 * collection follows it again; choosing All bookmarks, which is above every
 * page, keeps the page the reader turned to.
 */
function useFollowingPage(collections: Shelf[], selected: string) {
	const [turned, setTurned] = useState<{ page: number; selected: string } | null>(null);
	const listed = collections.some((shelf) => shelf.id === selected);
	const followed = pageWith(collections, (shelf) => shelf.id === selected, COLLECTIONS_PER_PAGE);
	const number = turned && (turned.selected === selected || !listed) ? turned.page : followed;
	return { number, turn: (page: number) => setTurned({ page, selected }) };
}

/**
 * One list in the column: its cover stack, name and count. The chosen
 * collection opens to show what it is for and, for its owner, Edit. The row
 * opens to its full height, so the rows below slide down instead of jumping.
 * All bookmarks never opens.
 */
function CollectionRow({
	userId,
	shelf,
	isSelected,
	onSelect,
	onEdit,
	onShare,
	onLeave,
}: {
	userId: string;
	shelf: Shelf;
	isSelected: boolean;
	onSelect: () => void;
	onEdit?: () => void;
	onShare?: () => void;
	/** For a collection shared with the reader. */
	onLeave?: () => void;
}) {
	const t = useTranslations("ui");
	const memberRole = shelf.access === "editor" || shelf.access === "viewer" ? shelf.access : null;
	const isOpen = isSelected && Boolean(shelf.description || onEdit || memberRole);
	return (
		<div className={twMerge("rounded-xl", isSelected && "bg-black/[0.04] dark:bg-white/[0.06]")}>
			<button
				type="button"
				aria-current={isSelected || undefined}
				onClick={onSelect}
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
					<span className="flex min-w-0 items-center gap-2.5">
						<span className="text-small text-black/50 dark:text-white/50">{t("collectionRecordCount", { count: shelf.count })}</span>
						<MemberFaces members={shelf.members} />
					</span>
				</span>
			</button>
			{shelf.id ? (
				<CollectionRowDetails
					isOpen={isOpen}
					description={shelf.description}
					onEdit={onEdit}
					onShare={onShare}
					memberRole={memberRole}
					onLeave={onLeave}
				/>
			) : null}
		</div>
	);
}

/**
 * What the chosen collection is for and, for its owner, Edit and Share; for
 * someone it is shared with, what they may do and Leave. It opens to its full height.
 */
function CollectionRowDetails({
	isOpen,
	description,
	onEdit,
	onShare,
	memberRole,
	onLeave,
}: {
	isOpen: boolean;
	description: string | null;
	onEdit?: () => void;
	onShare?: () => void;
	memberRole: "editor" | "viewer" | null;
	onLeave?: () => void;
}) {
	const t = useTranslations("ui");
	return (
		<div
			inert={!isOpen || undefined}
			className={twMerge(
				"grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
				isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
			)}
		>
			<div className="min-h-0 overflow-hidden">
				<div className="flex flex-col items-start gap-3 px-3 pb-3">
					{description ? <p className="text-small leading-relaxed text-black/60 dark:text-white/60">{description}</p> : null}
					{onEdit || onShare ? (
						<span className="flex gap-2">
							{onEdit ? (
								<Button
									onPress={onEdit}
									startContent={<HugeiconsIcon icon={PencilEdit01Icon} className="size-4" aria-hidden />}
									className="h-8 min-w-0 gap-1.5 bg-black/[0.05] px-3 text-small font-medium dark:bg-white/10"
								>
									{t("editAction")}
								</Button>
							) : null}
							{onShare ? (
								<Button
									onPress={onShare}
									startContent={<HugeiconsIcon icon={UserAdd01Icon} className="size-4" aria-hidden />}
									className="h-8 min-w-0 gap-1.5 bg-black/[0.05] px-3 text-small font-medium dark:bg-white/10"
								>
									{t("shareAction")}
								</Button>
							) : null}
						</span>
					) : null}
					{memberRole ? (
						<span className="flex w-full items-center justify-between gap-3">
							<RoleChip role={memberRole} />
							<Button
								onPress={onLeave}
								startContent={<HugeiconsIcon icon={Logout01Icon} className="size-4" aria-hidden />}
								className="h-8 min-w-0 gap-1.5 bg-black/[0.05] px-3 text-small font-medium dark:bg-white/10"
							>
								{t("leaveCollection")}
							</Button>
						</span>
					) : null}
				</div>
			</div>
		</div>
	);
}

/**
 * On the reader's own profile, the collections others shared with them, under
 * their own: each with its owner's face and what the reader may do with it.
 * Each opens on its owner's profile, where its records are.
 */
function SharedWithYou({ collections }: { collections: SharedCollectionSummary[] }) {
	const t = useTranslations("ui");
	const format = useFormatter();
	const [page, setPage] = useState(1);
	const { pages, current, shown } = pageOf(collections, page, COLLECTIONS_PER_PAGE);
	return (
		<div className="border-t border-black/[0.06] p-3 pt-4 dark:border-white/[0.08]">
			<h3 className="flex items-center gap-2 px-3 pb-2 text-small font-semibold text-black/60 dark:text-white/60">
				{t("sharedWithYou")}
				<span className="rounded-full bg-black/[0.05] px-2 text-tiny font-medium tabular-nums dark:bg-white/10">{format.number(collections.length)}</span>
			</h3>
			<ul className="flex flex-col gap-1" style={{ minHeight: pages > 1 ? COLLECTIONS_PAGE_HEIGHT : undefined }}>
				{shown.map((collection) => (
					<li key={collection.id}>
						<Link
							href={`/profile/${collection.owner.id}?collectionId=${collection.id}`}
							className="group flex w-full items-center gap-4 rounded-xl p-3 text-start text-black/80 outline-none hover:bg-black/[0.05] focus-visible:ring-2 focus-visible:ring-accent dark:text-white/80 dark:hover:bg-white/[0.06]"
						>
							<span className="relative flex shrink-0">
								<CoverStack userId={collection.owner.id} collectionId={collection.id} count={collection.count} fanned={false} />
								<ReaderAvatar
									reader={collection.owner}
									size="sm"
									className="absolute -bottom-1 end-1 h-7 w-7 text-[11px] ring-2 ring-white dark:ring-secondary"
									aria-hidden
								/>
							</span>
							<span className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="flex min-w-0 items-center gap-1.5">
									<span className="truncate font-medium">{collection.name}</span>
									{collection.private ? (
										<HugeiconsIcon icon={SquareLock01Icon} className="size-4 shrink-0 opacity-60" aria-label={t("privateCollection")} />
									) : null}
								</span>
								<span className="truncate text-small text-black/50 dark:text-white/50">{readerDisplayName(collection.owner, t)}</span>
							</span>
							<RoleChip role={collection.access} className="text-black/55 dark:text-white/55" />
						</Link>
					</li>
				))}
			</ul>
			<div className="px-2 pt-2 empty:hidden">
				<ListPager page={current} pages={pages} total={collections.length} perPage={COLLECTIONS_PER_PAGE} onChange={setPage} />
			</div>
		</div>
	);
}

function ProfileHeader({
	reader,
	userId,
	isOwnProfile,
	loading,
	bookmarkCount,
	collectionCount,
	firstBookmarkedAt,
}: {
	reader: { id: string; name: string; image: string | null };
	userId: string;
	isOwnProfile: boolean;
	/** Only the address is known: the reader and their counts show as placeholders the size of what replaces them. */
	loading: boolean;
	bookmarkCount: number;
	collectionCount: number | null;
	firstBookmarkedAt: Date | null;
}) {
	return (
		<header className="overflow-hidden rounded-2xl bg-white dark:bg-secondary">
			<CoverWall userId={userId} hasBookmarks={loading || bookmarkCount > 0} />
			<div className="flex flex-col gap-6 px-5 pb-6 sm:px-8 sm:pb-8 lg:flex-row lg:items-end lg:justify-between">
				<div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:gap-6">
					{/* The ring is the card's own colour, so the avatar reads as cut out of the covers behind it. */}
					<span className="relative -mt-14 w-fit shrink-0 rounded-full bg-white p-1.5 sm:-mt-16 dark:bg-secondary">
						{loading ? (
							<Skeleton className="h-24 w-24 rounded-full sm:h-28 sm:w-28" />
						) : (
							<ReaderAvatar reader={reader} size="lg" className="h-24 w-24 text-3xl sm:h-28 sm:w-28 [&_svg]:size-10" />
						)}
					</span>
					<div className="flex min-w-0 flex-col gap-3">
						{loading ? (
							<>
								{/* The name's line height, and the stats line's. */}
								<Skeleton className="h-10 w-64 max-w-full rounded-xl sm:h-12 sm:w-80" />
								<Skeleton className="h-7 w-72 max-w-full rounded-lg" />
							</>
						) : (
							<ProfileName
								reader={reader}
								bookmarkCount={bookmarkCount}
								collectionCount={collectionCount}
								firstBookmarkedAt={firstBookmarkedAt}
							/>
						)}
					</div>
				</div>
				<ProfileActions isOwnProfile={isOwnProfile} loading={loading} readerName={reader.name} />
			</div>
		</header>
	);
}

/** The reader's name and what they have saved. */
function ProfileName({
	reader,
	bookmarkCount,
	collectionCount,
	firstBookmarkedAt,
}: {
	reader: { id: string; name: string; image: string | null };
	bookmarkCount: number;
	collectionCount: number | null;
	firstBookmarkedAt: Date | null;
}) {
	const t = useTranslations("ui");
	const format = useFormatter();
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
		<>
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
		</>
	);
}

/** Share for anyone; the owner also edits their account, a placeholder while their name is not known. */
function ProfileActions({ isOwnProfile, loading, readerName }: { isOwnProfile: boolean; loading: boolean; readerName: string }) {
	const accountUrl = useOpenScholarAccountUrl();
	const t = useTranslations("ui");
	const { copy, copied } = useClipboardFeedback();
	return (
		<div className="flex shrink-0 flex-wrap gap-2">
			<Button
				onPress={() => copy(`${window.location.origin}${window.location.pathname}`)}
				startContent={<HugeiconsIcon icon={copied ? Tick02Icon : Share08Icon} className="size-5" aria-hidden />}
				className="h-10 px-4 font-medium"
			>
				{copied ? t("profileLinkCopied") : t("shareProfile")}
			</Button>
			{isOwnProfile && loading ? (
				<Skeleton className="h-10 w-36 rounded-xl" />
			) : isOwnProfile ? (
				<Button
					as="a"
					href={accountUrl}
					target="_blank"
					rel="noopener"
					startContent={<HugeiconsIcon icon={UserEdit01Icon} className="size-5" aria-hidden />}
					className="h-10 px-4 font-medium"
				>
					{readerName.trim() ? t("editProfile") : t("addYourName")}
				</Button>
			) : null}
		</div>
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
function CoverWall({ userId, hasBookmarks }: { userId: string; hasBookmarks: boolean }) {
	const { data } = useShelfItems(userId, "");
	const records = data?.items ?? [];
	const wall = records.length > 0 ? Array.from({ length: WALL_SIZE }, (_, index) => records[index % records.length]!) : [];
	return (
		<div aria-hidden className="relative h-40 overflow-hidden bg-accent/10 sm:h-52">
			{hasBookmarks ? (
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
