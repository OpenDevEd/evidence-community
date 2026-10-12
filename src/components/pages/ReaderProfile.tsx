"use client";

import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { useFormatter, useTranslations } from "next-intl";
import { ModalBody, ModalContent, ModalFooter } from "@nextui-org/react";
import {
	Add01Icon,
	ArrowDown01Icon,
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
import { toast } from "@/components/layout/Toast";
import DialogModal from "@/components/nextui/DialogModal";
import { Input } from "@/components/nextui/Input";
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
import type { CollectionAccess, CollectionMember, CollectionsPage, ProfileCollectionsPage, ReaderCollectionSummary, SharedCollectionSummary } from "@/lib/readers/data";
import { PROFILE_COLLECTIONS_PER_PAGE, profileCollectionsKey, sharedCollectionsKey } from "@/lib/readers/collection-pages";
import { fetcher } from "@/lib/utils";
import { Link } from "@/i18n/routing";
import { MemberFaces, RoleChip, ShareCollectionDialog, useSentInvitations } from "@/components/features/collections/CollectionPeople";
import { CoverStack, useShelfItems } from "@/components/features/collections/CoverStack";
import { ListPager } from "@/components/features/collections/ListPager";
import { ReaderAvatar, readerDisplayName } from "@/components/layout/navbar/UserMenu";
import PageContainer from "@/components/layout/PageContainer";

type ProfileCollection = ReaderCollectionSummary;
type CollectionInput = { name: string; description: string | null; private: boolean };

/** What anyone may see of a reader: never their email; private collections only for themselves and who they share them with. */
export type ProfileData = {
	id: string;
	name: string;
	image: string | null;
	bookmarks: Record<string, string>;
	/** The page of their collections the chosen one is on, as the server rendered it. */
	collections: ProfileCollectionsPage;
	/** On the reader's own profile, the first page of the collections others shared with them. */
	shared: CollectionsPage<SharedCollectionSummary> | null;
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

/** One list in the column or the sheet: All bookmarks, or one collection. */
type Shelf = {
	id: string;
	name: string;
	count: number;
	isPrivate: boolean;
	description: string | null;
	access: CollectionAccess;
	members: CollectionMember[];
};

/**
 * A page of a list as it is drawn: its rows, the page asked for, and whether those rows are still the last page's
 * while the asked one is on its way, which leaves them dimmed and inert.
 */
type ShownPage<Row> = { rows: Row[]; page: number; pages: number; total: number; waiting: boolean; turn: (page: number) => void };

/** What the column and the phone sheet choose from, and what the viewer may do with the chosen list. */
type CollectionChoices = {
	all: Shelf;
	collections: ShownPage<Shelf>;
	/** On the reader's own profile, the collections others shared with them. */
	shared: ShownPage<SharedCollectionSummary> | null;
	selected: string;
	/** The chosen collection wherever it is, which the list's own page may not hold. */
	chosen: Shelf | null;
	onSelect: (id: string) => void;
	/** Only the owner edits, adds and shares their collections. */
	onEdit?: (id: string) => void;
	onCreate?: () => void;
	onShare?: (id: string) => void;
	/** A member leaves a collection shared with them. */
	onLeave: (id: string) => void;
};

/** What the reader was given a collection as, when it's shared with them rather than theirs. */
const memberRoleOf = (access: CollectionAccess) => (access === "owner" ? null : access);

const shelfOf = (collection: ProfileCollection): Shelf => ({
	id: collection.id,
	name: collection.name,
	count: collection.count,
	isPrivate: collection.private,
	description: collection.description,
	access: collection.access,
	members: collection.members,
});

function firstBookmarkDate(bookmarks: Record<string, string>) {
	const times = Object.values(bookmarks).map((value) => new Date(value).getTime()).filter((time) => !Number.isNaN(time));
	return times.length > 0 ? new Date(Math.min(...times)) : null;
}

/** A page of a list read from the server, keeping the last page on screen while the next is on its way. */
function useServerPage<Page extends CollectionsPage<unknown>>(key: string | null, first: Page, page: number) {
	const { data, isLoading } = useSWR<Page>(key, fetcher, {
		keepPreviousData: true,
		revalidateOnFocus: false,
		// The page the server rendered, until the browser has its own.
		fallbackData: page === first.page ? first : undefined,
	});
	const shown = data ?? first;
	// While the asked page is on its way it is the one named; once in, the one the server sent, which stays within the list.
	return { shown, waiting: isLoading, page: isLoading ? page : shown.page };
}

/**
 * The page of a profile's collections the column shows. It starts on the page the server rendered, the one the
 * chosen collection is on, and stays where the reader turns it: choosing a collection on it, or All bookmarks, reads
 * nothing. A new page from the server, as after a link to another collection, starts from its own page again.
 */
function useProfileCollections(data: ProfileData, viewer: string | null, selected: string, loading: boolean) {
	const [turned, setTurned] = useState<{ page: number; from: ProfileCollectionsPage } | null>(null);
	const page = turned?.from === data.collections ? turned.page : data.collections.page;
	const { shown, waiting, page: served } = useServerPage(loading ? null : profileCollectionsKey(data.id, { viewer, page }), data.collections, page);
	const chosen = useChosenCollection(data, loading ? null : { viewer, selected }, shown.rows);
	return {
		page: { rows: shown.rows.map(shelfOf), page: served, pages: shown.pages, total: shown.total, waiting, turn: (next: number) => setTurned({ page: next, from: data.collections }) },
		chosen,
		known: [...shown.rows, ...chosen],
	};
}

type Choice = { viewer: string | null; selected: string };

/** The chosen collection, if any: on the page shown, or else read alone, for whatever shows it beside the list. */
function useChosenCollection(data: ProfileData, choice: Choice | null, rows: ProfileCollection[]): ProfileCollection[] {
	const onPage = rows.find((collection) => collection.id === choice?.selected);
	const seen = useLastSeen(onPage, data.collections.chosen);
	const alone = useCollectionAlone(data.id, onPage ? null : choice, seen);
	const chosen = onPage ?? alone;
	return chosen ? [chosen] : [];
}

/** What was last seen of the chosen collection on a page; at first, as the server sent it with the profile. */
function useLastSeen(onPage: ProfileCollection | undefined, sent: ProfileCollection | null) {
	const [seen, setSeen] = useState(sent);
	if (onPage && onPage !== seen) setSeen(onPage);
	return seen;
}

/**
 * The chosen collection read alone, when the page shown doesn't hold it. Until the read answers it is what was last
 * seen of it, as on the page the reader turned away from. The read answers nothing for one the viewer may not see.
 */
function useCollectionAlone(userId: string, choice: Choice | null, seen: ProfileCollection | null) {
	const { data } = useSWR<{ chosen: ProfileCollection | null }>(choice?.selected ? profileCollectionsKey(userId, { viewer: choice.viewer, collectionId: choice.selected }) : null, fetcher, {
		revalidateOnFocus: false,
		fallbackData: seen && seen.id === choice?.selected ? { chosen: seen } : undefined,
	});
	return data?.chosen ?? null;
}

/** The reader's bookmarks; on their own profile their live ones, so a record bookmarked elsewhere counts at once. */
function useProfileBookmarks(data: ProfileData, isOwnProfile: boolean) {
	const { data: own } = useReaderData();
	return (isOwnProfile ? own?.bookmarks : undefined) ?? data.bookmarks;
}

const NOTHING_SHARED: CollectionsPage<SharedCollectionSummary> = { rows: [], page: 1, pages: 1, total: 0 };

/**
 * The collections shared with the reader, on their own profile, a page at a time from the first the server rendered;
 * only while the owner is signed in here, as after a sign-out in another tab they no longer are.
 */
function useSharedCollections(sent: ProfileData["shared"], viewer: string | null, isOwnProfile: boolean): ShownPage<SharedCollectionSummary> | null {
	const first = isOwnProfile ? sent : null;
	const [page, setPage] = useState(1);
	const { shown, waiting, page: served } = useServerPage(first ? sharedCollectionsKey({ viewer, page }) : null, first ?? NOTHING_SHARED, page);
	return first ? { rows: shown.rows, page: served, pages: shown.pages, total: shown.total, waiting, turn: setPage } : null;
}

/**
 * Saving and deleting the owner's collections. A change reloads every list of collections and records already shown.
 * A new collection opens at once, on the column's last page, where the newest one is.
 */
function useCollectionChanges(selected: string, select: (id: string) => void, collections: ShownPage<Shelf>) {
	const { refresh } = useReaderData();
	return {
		save: async (id: string | null, input: CollectionInput) => {
			const made = await sendCollectionChange(id ? `/reader/collections/${id}` : "/reader/collections", id ? "PATCH" : "POST", input);
			if (made) {
				select(made.id);
				collections.turn(Math.ceil((collections.total + 1) / PROFILE_COLLECTIONS_PER_PAGE));
			}
			await refresh();
		},
		remove: async (id: string) => {
			await sendCollectionChange(`/reader/collections/${id}`, "DELETE");
			if (selected === id) select("");
			await refresh();
		},
	};
}

/** Leaving a collection someone shared with the reader, after asking. */
function useLeaveCollection(selected: string, select: (id: string) => void, known: ProfileCollection[]) {
	const t = useTranslations("ui");
	const { reader, refresh } = useReaderData();
	const [leaving, setLeaving] = useState<ProfileCollection | null>(null);
	return {
		leaving,
		ask: (id: string) => setLeaving(known.find((collection) => collection.id === id) ?? null),
		cancel: () => setLeaving(null),
		leave: async () => {
			if (!leaving || !reader) return;
			// A refusal keeps the question open, so the reader can try again.
			const left = await sendCollectionChange(`/reader/collections/${leaving.id}/members/${reader.id}`, "DELETE").then(
				() => true,
				(error: unknown) => {
					toast({ type: "error", title: t("sharingFailed"), description: error instanceof Error ? error.message : undefined });
					return false;
				},
			);
			if (!left) return;
			if (selected === leaving.id) select("");
			setLeaving(null);
			await refresh();
		},
	};
}

/** Which of the owner's collections the Share dialog is open on, with the invitations they sent, read once for the whole profile. */
function useSharing(isOwnProfile: boolean, known: ProfileCollection[]) {
	const { data: sent } = useSentInvitations(isOwnProfile);
	const [sharing, setSharing] = useState<string | null>(null);
	return {
		onShare: isOwnProfile ? setSharing : undefined,
		collection: known.find((collection) => collection.id === sharing),
		invitations: sent?.invitations,
		close: () => setSharing(null),
	};
}

/** The profile's dialogs: editing or making a collection, sharing one, and leaving one shared with the reader. */
function ProfileDialogs({
	editing,
	sharing,
	leaving,
	ownerName,
}: {
	editing: Pick<ReturnType<typeof useCollectionDialog>, "dialog" | "close"> & Pick<ReturnType<typeof useCollectionChanges>, "save" | "remove">;
	sharing: ReturnType<typeof useSharing>;
	leaving: ReturnType<typeof useLeaveCollection>;
	ownerName: string;
}) {
	const t = useTranslations("ui");
	return (
		<>
			{editing.dialog ? (
				<CollectionDialog
					key={editing.dialog.collection?.id ?? "new"}
					collection={editing.dialog.collection}
					onClose={editing.close}
					onSave={editing.save}
					onDelete={editing.remove}
				/>
			) : null}
			{sharing.collection ? <ShareCollectionDialog collection={sharing.collection} invitations={sharing.invitations} onClose={sharing.close} /> : null}
			{leaving.leaving ? (
				<ConfirmationModal
					isOpen
					onOpenChange={(open) => !open && leaving.cancel()}
					title={t("leaveCollectionTitle", { name: leaving.leaving.name })}
					description={t("leaveCollectionBody", { owner: ownerName })}
					confirmLabel={t("leaveCollection")}
					cancelLabel={t("cancel")}
					onConfirm={() => void leaving.leave()}
				/>
			) : null}
		</>
	);
}

/**
 * A reader's page: their card on top, then their bookmarks the way the
 * library lists records, with search and sort, and their collections beside
 * it where the library keeps its filters, a page at a time.
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
	const viewer = useReaderSession().reader?.id ?? null;
	const isOwnProfile = viewer === data.id;
	const items = useItemsList(data);
	const bookmarks = useProfileBookmarks(data, isOwnProfile);
	const bookmarkCount = Object.keys(bookmarks).length;
	const selected = items.queryParams.collectionId || "";
	const select = (id: string) => items.handleCollectionSelect(id);
	const collections = useProfileCollections(data, viewer, selected, loading);
	const shared = useSharedCollections(data.shared, viewer, isOwnProfile);
	const sharing = useSharing(isOwnProfile, collections.known);
	const changes = useCollectionChanges(selected, select, collections.page);
	const editing = useCollectionDialog(isOwnProfile, collections.known);
	const leaving = useLeaveCollection(selected, select, collections.known);
	const choices: CollectionChoices = {
		all: { id: "", name: t("allBookmarks"), count: bookmarkCount, isPrivate: false, description: null, access: null, members: [] },
		collections: collections.page,
		shared,
		selected,
		chosen: collections.chosen.map(shelfOf)[0] ?? null,
		onSelect: select,
		onEdit: editing.edit,
		onCreate: editing.create,
		onShare: sharing.onShare,
		onLeave: leaving.ask,
	};

	return (
		<PageContainer id="main-content" className="flex w-full flex-col gap-8 xl:gap-10">
			<ProfileHeader
				reader={{ id: data.id, name: data.name, image: data.image }}
				userId={data.id}
				isOwnProfile={isOwnProfile}
				loading={loading}
				bookmarkCount={bookmarkCount}
				collectionCount={collections.page.total}
				firstBookmarkedAt={firstBookmarkDate(bookmarks)}
			/>
			<div id={LIST_TOP_ID} className="flex scroll-mt-6 flex-col gap-8 lg:flex-row xl:gap-10">
				<CollectionsNav userId={data.id} loading={loading} {...choices} />
				<div className="flex min-w-0 flex-1 flex-col gap-4">
					<ItemsList
						props={items}
						header={(choices.chosen ?? choices.all).name}
						userData={{ id: data.id, collections: collections.chosen }}
						extraFilters={<PhoneCollectionPicker userId={data.id} {...choices} />}
					/>
				</div>
			</div>
			<ProfileDialogs editing={{ ...editing, ...changes }} sharing={sharing} leaving={leaving} ownerName={readerDisplayName(data, t)} />
		</PageContainer>
	);
}

/**
 * On phones the column is hidden: a button beside the filters names the chosen list and opens the same paged lists
 * as a sheet, and the owner's actions sit next to it.
 */
function PhoneCollectionPicker({ userId, ...choices }: { userId: string } & CollectionChoices) {
	const t = useTranslations("ui");
	const [open, setOpen] = useState(false);
	const shown = choices.chosen ?? choices.all;
	return (
		<div className="flex gap-2 lg:hidden">
			<Button
				aria-haspopup="dialog"
				aria-label={t("bookmarksListAriaLabel")}
				onPress={() => setOpen(true)}
				startContent={<HugeiconsIcon icon={choices.chosen ? CollectionsBookmarkIcon : Bookmark02Icon} className="size-5 shrink-0" aria-hidden />}
				endContent={<HugeiconsIcon icon={ArrowDown01Icon} className="ms-auto size-4 shrink-0 opacity-60" aria-hidden />}
				className="h-12 min-w-0 flex-1 justify-start gap-2 px-4 font-medium"
			>
				<span className="truncate">{shown.name}</span>
			</Button>
			<PhoneCollectionActions {...choices} />
			<DialogModal isOpen={open} onOpenChange={setOpen} scrollBehavior="inside">
				<ModalContent>
					<GenericHeader onClose={() => setOpen(false)}>{t("collections")}</GenericHeader>
					<ModalBody className="gap-0 px-0 pb-3 pt-0">
						{/* Choosing a list closes the sheet; the actions beside the button act on it. */}
						<CollectionPages
							userId={userId}
							loading={false}
							{...choices}
							onSelect={(id) => {
								choices.onSelect(id);
								setOpen(false);
							}}
							onEdit={undefined}
							onShare={undefined}
						/>
						{choices.shared && choices.shared.total > 0 ? <SharedWithYou shared={choices.shared} /> : null}
					</ModalBody>
				</ModalContent>
			</DialogModal>
		</div>
	);
}

/** What the viewer may do with the list the button shows: the owner shares and edits it and adds collections; a member leaves it. */
function PhoneCollectionActions({ chosen, selected, onEdit, onCreate, onShare, onLeave }: CollectionChoices) {
	const t = useTranslations("ui");
	// A collection is chosen: All bookmarks is shared, edited and left by nobody.
	const onChosen = (run?: (id: string) => void) => (run && selected ? () => run(selected) : undefined);
	const isMember = memberRoleOf(chosen?.access ?? null) !== null;
	return (
		<>
			<PhoneAction label={t("shareAction")} icon={UserAdd01Icon} onPress={onChosen(onShare)} />
			<PhoneAction label={t("leaveCollection")} icon={Logout01Icon} onPress={onChosen(isMember ? onLeave : undefined)} />
			<PhoneAction label={t("editCollection")} icon={PencilEdit01Icon} onPress={onChosen(onEdit)} />
			<PhoneAction label={t("newCollection")} icon={Add01Icon} onPress={onCreate} />
		</>
	);
}

/** An icon button beside the phone picker, there only while it can do something. */
function PhoneAction({ label, icon, onPress }: { label: string; icon: typeof Add01Icon; onPress?: () => void }) {
	if (!onPress) return null;
	return (
		<Tooltip content={label}>
			<Button isIconOnly aria-label={label} onPress={onPress} className="h-12 w-12 shrink-0">
				<HugeiconsIcon icon={icon} className="size-5" aria-hidden />
			</Button>
		</Tooltip>
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
	...choices
}: {
	userId: string;
	/** The reader's collections are not known yet: their count and rows show as placeholders. */
	loading: boolean;
} & CollectionChoices) {
	const t = useTranslations("ui");
	return (
		<aside id="collections" aria-label={t("bookmarksListAriaLabel")} className="hidden w-full shrink-0 lg:block lg:w-[24rem] xl:w-[28.5rem]">
			{/* The same card as the profile's own, its head tinted like the cover band above. */}
			<nav className="overflow-hidden rounded-2xl bg-white dark:bg-secondary">
				<CollectionsHead loading={loading} count={choices.collections.total} onCreate={choices.onCreate} />
				<CollectionPages userId={userId} loading={loading} {...choices} />
				{choices.shared && choices.shared.total > 0 ? <SharedWithYou shared={choices.shared} /> : null}
			</nav>
		</aside>
	);
}

/** The column's heading, how many collections the reader has, and New collection for its owner. */
function CollectionsHead({ loading, count, onCreate }: { loading: boolean; count: number; onCreate?: () => void }) {
	const t = useTranslations("ui");
	const format = useFormatter();
	return (
		<div className="flex items-center justify-between gap-3 bg-accent/10 px-5 py-4">
			<h2 className="flex items-center gap-2.5 font-heading text-xl font-semibold tracking-tight text-foreground dark:text-white">
				{t("collections")}
				{loading ? (
					<Skeleton className="h-5 w-7 rounded-full" />
				) : (
					<span className="rounded-full bg-white px-2 text-small font-medium tabular-nums text-black/70 dark:bg-white/10 dark:text-white/70">
						{format.number(count)}
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
	);
}

/** All bookmarks, then the page of collections the column shows, then the pages. */
function CollectionPages({ userId, loading, all, collections, selected, onSelect, onEdit, onShare, onLeave }: { userId: string; loading: boolean } & CollectionChoices) {
	const forShelf = (run: ((id: string) => void) | undefined, id: string) => (run ? () => run(id) : undefined);
	return (
		<div className="flex flex-col gap-1 p-3">
			{loading ? (
				// One row, as tall as a row with its cover stack. The reader's collections are not known yet, so no page follows it.
				<Skeleton className="h-24 rounded-xl" />
			) : (
				<CollectionRow userId={userId} shelf={all} isSelected={selected === ""} onSelect={() => onSelect("")} />
			)}
			<PagedRows page={collections}>
				{collections.rows.map((shelf) => (
					<li key={shelf.id}>
						<CollectionRow
							userId={userId}
							shelf={shelf}
							// The chosen row folds as soon as the reader turns away from its page, not when the next page comes.
							isSelected={shelf.id === selected && !collections.waiting}
							onSelect={() => onSelect(shelf.id)}
							onEdit={forShelf(onEdit, shelf.id)}
							onShare={forShelf(onShare, shelf.id)}
							onLeave={() => onLeave(shelf.id)}
						/>
					</li>
				))}
			</PagedRows>
		</div>
	);
}

/** That many rows (a cover stack and its padding, 6rem) with the gaps between them. */
const COLLECTIONS_PAGE_HEIGHT = `calc(${PROFILE_COLLECTIONS_PER_PAGE} * 6rem + ${PROFILE_COLLECTIONS_PER_PAGE - 1} * 0.25rem)`;

/**
 * A page of rows and the pages under it. A page keeps a full page's height, so turning to a shorter last page moves
 * nothing below. While the page turned to is on its way, the last one stays, dimmed and inert.
 */
function PagedRows<Row>({ page, children }: { page: ShownPage<Row>; children: ReactNode }) {
	return (
		<>
			<ul
				inert={page.waiting || undefined}
				className={twMerge("flex flex-col gap-1 transition-opacity duration-150 motion-reduce:transition-none", page.waiting && "opacity-50")}
				style={{ minHeight: page.pages > 1 ? COLLECTIONS_PAGE_HEIGHT : undefined }}
			>
				{children}
			</ul>
			<div className="px-2 pt-2 empty:hidden">
				<ListPager page={page.page} pages={page.pages} total={page.total} perPage={PROFILE_COLLECTIONS_PER_PAGE} onChange={page.turn} />
			</div>
		</>
	);
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
	const memberRole = memberRoleOf(shelf.access);
	return (
		<div className={twMerge("rounded-xl", isSelected && "bg-black/[0.04] dark:bg-white/[0.06]")}>
			<CollectionRowButton userId={userId} shelf={shelf} isSelected={isSelected} onSelect={onSelect} />
			{shelf.id ? (
				<CollectionRowDetails
					isOpen={isSelected && hasDetails(shelf.description, onEdit, memberRole)}
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

/** Whether a chosen collection opens: to say what it is for, for its owner's Edit, or for a member's role and Leave. */
const hasDetails = (description: string | null, onEdit: (() => void) | undefined, memberRole: string | null) => Boolean(description || onEdit || memberRole);

/** A list's cover stack, name, lock and count, which chooses it. */
function CollectionRowButton({ userId, shelf, isSelected, onSelect }: { userId: string; shelf: Shelf; isSelected: boolean; onSelect: () => void }) {
	const t = useTranslations("ui");
	return (
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
					{shelf.isPrivate ? <HugeiconsIcon icon={SquareLock01Icon} className="size-4 shrink-0 opacity-60" aria-label={t("privateCollection")} /> : null}
				</span>
				<span className="flex min-w-0 items-center gap-2.5">
					<span className="text-small text-black/50 dark:text-white/50">{t("collectionRecordCount", { count: shelf.count })}</span>
					<MemberFaces members={shelf.members} />
				</span>
			</span>
		</button>
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
function SharedWithYou({ shared }: { shared: ShownPage<SharedCollectionSummary> }) {
	const t = useTranslations("ui");
	const format = useFormatter();
	return (
		<div className="border-t border-black/[0.06] p-3 pt-4 dark:border-white/[0.08]">
			<h3 className="flex items-center gap-2 px-3 pb-2 text-small font-semibold text-black/60 dark:text-white/60">
				{t("sharedWithYou")}
				<span className="rounded-full bg-black/[0.05] px-2 text-tiny font-medium tabular-nums dark:bg-white/10">{format.number(shared.total)}</span>
			</h3>
			<PagedRows page={shared}>
				{shared.rows.map((collection) => (
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
			</PagedRows>
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
