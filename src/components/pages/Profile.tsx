"use client";

import Image from "next/image";
import {
	BsBookmark,
	BsBoxArrowRight,
	BsCollection,
	BsGear,
	BsPen,
	BsPencil,
	BsPlus,
	BsThreeDotsVertical,
} from "react-icons/bs";
import { Button } from "../nextui/Button";
import { ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormatter } from "next-intl";
import { useSession } from "next-auth/react";
import { Session } from "next-auth";
import {
	fetcher,
	buildItemsQuery,
	setter,
	defaultParams,
	fetcherDELETE,
} from "@/lib/utils";
import useSWRMutation from "swr/mutation";
import { twMerge } from "tailwind-merge";
import { Textarea } from "../nextui/Textarea";
import { Input } from "../nextui/Input";
import {
	AutocompleteItem,
	Divider,
	DropdownItem,
	DropdownMenu,
	DropdownSection,
	DropdownTrigger,
	Listbox,
	ListboxItem,
	ListboxItemProps,
	ListboxProps,
	ModalBody,
	ModalContent,
	SelectItem
} from "@nextui-org/react";
import { useDisclosure } from "@nextui-org/react";
import GenericHeader from "../features/modals/GenericHeader";
import { Select } from "../nextui/Select";
import {
	COLLECTION_VISIBILITY_OPTIONS
} from "@/constants/user";
import { useModalError } from "@/hooks/useModalError";
import { AnimatePresence } from "framer-motion";
import { ResourcesView } from "../features/resources/ResourcesView";
import { CacheContext, useLastFetchedData } from "@/context/Providers";
import { useParamsState } from "@/hooks/useParamsState";
import { ItemsGetResponse } from "@/app/api/items/types";
import useSWR from "swr";
import { IconType } from "react-icons/lib";
import PageContainer from "../layout/PageContainer";
import { Autocomplete } from "../nextui/Autocomplete";
import DialogModal from "../nextui/DialogModal";
import { BiTrash } from "react-icons/bi";
import { usePathname, useSearchParams } from "next/navigation";
import { Dropdown } from "../nextui/Dropdown";
import { CollectionsGetResponse } from "@/app/api/collections/types";
import { useHierarchy } from "@/hooks/useHierarchy";

function Pen() {
	return (
		<div className="rounded-full bg-primary dark:bg-secondary flex items-center justify-center p-1.5 size-6">
			<BsPen className="size-full fill-black/60 dark:fill-white/60 " />
		</div>
	);
}

function FollowButton({
	displayData,
	session,
	update,
}: {
	displayData: any;
	session: Session | null;
	update: any;
}) {
	const [loading, setLoading] = useState(false);
	const { trigger } = useSWRMutation(`/user/follows`, setter);

	const isFollowing = useMemo(() => {
		return session?.user.following[displayData.id] ?? false;
	}, [displayData, session]);

	const handleClick = useCallback(async () => {
		setLoading(true);
		try {
			await trigger({ id: displayData.id });
			await update();
		} catch (error) {
			console.error(error);
		} finally {
			setLoading(false);
		}
	}, [trigger, displayData, update]);

	return (
		<Button
			color={isFollowing ? "danger" : "accent"}
			onPress={handleClick}
			isLoading={loading}
			className={twMerge(!session && "hidden")}
		>
			{isFollowing ? "Unfollow" : "Follow"}
		</Button>
	);
}

function CreateCollectionModal({
	update,
	onClose,
	isOpen,
	onOpenChange,
}: {
	update: any;
	onClose: any;
	isOpen: boolean;
	onOpenChange: any;
}) {
	const [loading, setLoading] = useState(false);
	const {
		displayOnError,
		errorClassName,
		ErrorField,
		containerRef,
		errorMessage,
	} = useModalError({
		initial: {
			height: 0,
			opacity: 0,
		},
		animate: { height: "auto", opacity: 1 },
		exit: { height: 0, opacity: 0, y: 0, marginTop: -12 },
	});
	const { trigger } = useSWRMutation(`/user/collections`, setter);
	const t = useTranslations("ui");

	const handleSubmit = async (e: any) => {
		e.preventDefault();
		const formData = new FormData(e.target);
		const data = Object.fromEntries(formData.entries());
		setLoading(true);
		try {
			const res = await trigger({
				name: data.name as string,
				description: data.description as string,
				private: data.private === "private",
			});
			if (!res.ok) {
				const error = await res.json();
				throw error;
			}
			await update();
			onClose();
		} catch (error: any) {
			displayOnError(error);
		} finally {
			setLoading(false);
		}
	};

	return (
		<DialogModal size="md" isOpen={isOpen} onOpenChange={onOpenChange}>
			<ModalContent className={errorClassName}>
				<GenericHeader onClose={onClose}>
					{t("createCollection")}
				</GenericHeader>
				<ModalBody className="pb-6 pt-0">
					<div ref={containerRef} className="flex flex-col w-full">
						<p className="text-sm text-black/60 dark:text-white/60 mb-6 text-center">
							{t("collectionDescription")}
						</p>
						<form
							onSubmit={handleSubmit}
							className="flex flex-col gap-3"
						>
							<Input
								autoComplete="off"
								autoFocus
								label={t("collectionName")}
								name="name"
								placeholder={t("collectionName")}
							/>
							<Textarea
								autoComplete="off"
								label={t("collectionDescriptionDescription")}
								name="description"
								color="secondary"
								placeholder={t(
									"collectionDescriptionDescription"
								)}
							/>
							<Select
								name="private"
								placement="left"
								label={t("collectionVisibility")}
								color="tertiary"
								className="min-w-full"
								items={COLLECTION_VISIBILITY_OPTIONS.map(
									(item) => ({
										...item,
										name: t(
											"collectionVisibility" + item.name
										),
									})
								)}
								isDisabled
								disallowEmptySelection
								defaultSelectedKeys={[
									COLLECTION_VISIBILITY_OPTIONS[0].key,
								]}
							>
								{(item: any) => (
									<SelectItem
										aria-label={item.name}
										key={item.key}
									>
										{item.name}
									</SelectItem>
								)}
							</Select>
							<AnimatePresence mode="sync">
								{errorMessage && <ErrorField />}
							</AnimatePresence>
							<Button
								color="accent"
								size="md"
								type="submit"
								isLoading={loading}
							>
								{t("createCollection")}
							</Button>
						</form>
					</div>
				</ModalBody>
			</ModalContent>
		</DialogModal>
	);
}

function NumberWrapper({ children }: { children: ReactNode }) {
	return (
		<span className="text-xl font-medium text-black/80 dark:text-white/80">
			{children}
		</span>
	);
}

function CollectionWrapper({ children }: { children: ReactNode }) {
	return (
		<span className="text-sm text-black/60 dark:text-white/60">
			{children}
		</span>
	);
}

export function useItemsList(userData?: any) {
	const searchParamsFromParams = useSearchParams()

	const pathName = usePathname()

	const searchParams = Object.fromEntries(searchParamsFromParams.entries()) as any

	const { setLastFetchedData } = useLastFetchedData();

	const { itemsCache } = useContext(CacheContext);

	const { router, pathname, createQueryString } =
		useParamsState(searchParams );

	const queryParams = defaultParams(searchParams );

	const itemsQuery = buildItemsQuery(queryParams, userData ? `/user/items/${userData.id}` : "/items");

	const handlePageChange = useCallback(
		(newPage: number) => {
			router.push(
				createQueryString(pathname, [["page", String(newPage)]])
			);
		},
		[router, pathname, createQueryString]
	);

	const handleSortChange = useCallback(
		(sort: Set<string>) => {
			const value = sort.values().next().value;
			if (value)
				router.push(createQueryString(pathname, [["sort", value]]));
		},
		[router, pathname, createQueryString]
	);

	const handleScopeChange = useCallback(
		(scope: Set<string>) => {
			const value = scope.values().next().value;
			if (value)
				router.push(createQueryString(pathname, [["scope", value]]));
		},
		[router, pathname, createQueryString]
	);

	const handleSearchChange = useCallback(
		(text: string) =>
			router.push(
				createQueryString(pathname, [
					["search", text],
					["page", "1"],
				])
			),
		[router, pathname, createQueryString]
	);

	const handleRangeChange = useCallback(
		(start: string | null, end: string | null) => {
			router.push(
				createQueryString(pathname, [
					["range", [start, end].join(end !== null ? "-" : "")],
				])
			);
		},
		[router, pathname, createQueryString]
	);

	const handleCollectionSelect = (collectionId: string) => {
		if (collectionId === queryParams.collectionId) {
			router.push(createQueryString(pathname, [["collectionId", ""]]));
		} else {
			router.push(
				createQueryString(pathname, [["collectionId", collectionId]])
			);
		}
	};

	const {
		data: fetchedItemsData,
		error: itemsError,
		isLoading: isItemsLoading,
		isValidating: isItemsFetching,
		mutate: revalidateResults,
	} = useSWR<ItemsGetResponse>(itemsQuery, fetcher, {
		keepPreviousData: true,
		onSuccess: (data) => {
			if (data.totalPages < queryParams.page) {
				handlePageChange(data.totalPages);
			}
			setLastFetchedData(data);
		},
	});

	if (fetchedItemsData) {
		itemsCache.current[pathName] = fetchedItemsData;
	}

	const itemsData = itemsCache.current[pathName]

	const {
		data: collectionsData,
		error: collectionsError,
		isLoading: isCollectionsLoading,
	} = useSWR<CollectionsGetResponse>("/collections", fetcher, {
		keepPreviousData: true,
	});

	const { hierarchy, handleCheckboxChange, selectedCollections } =
		useHierarchy({
			data: collectionsData,
			searchParams
		});


	return {
		itemsData,
		itemsError,
		isItemsLoading,
		isItemsFetching,
		revalidateResults,
		handlePageChange,
		handleSortChange,
		handleScopeChange,
		handleSearchChange,
		handleRangeChange,
		queryParams,
		collectionsData,
		collectionsError,
		isCollectionsLoading,
		hierarchy,
		handleCheckboxChange,
		selectedCollections,
		searchParams,
		handleCollectionSelect,
		pathName
	};
}

export function ItemsList({
	userData,
	extraFilters,
	props,
}: {
	userData?: any;
	extraFilters?: ReactNode;
	props: ReturnType<typeof useItemsList>;
}) {
	const t = useTranslations("ui");
	const formatter = useFormatter();

	return (
		<ResourcesView
			sort={props.queryParams.sort}
			search={props.queryParams.search}
			scope={props.queryParams.scope}
			handleSearchChange={props.handleSearchChange}
			handleScopeChange={props.handleScopeChange}
			handleSortChange={props.handleSortChange}
			itemsData={props.itemsData}
			itemsError={props.itemsError}
			isItemsLoading={props.isItemsLoading}
			range={props.queryParams.range}
			handleRangeChange={props.handleRangeChange}
			pageNumber={props.queryParams.page}
			handlePageChange={props.handlePageChange}
			searchParams={props.searchParams}
			isItemsFetching={props.isItemsFetching}
			revalidateResults={props.revalidateResults}
			extraFilters={extraFilters}
			queryParams={props.queryParams}
			{...(!userData ? {
				collectionsData: props.collectionsData,
				hierarchy: props.hierarchy,
				handleCheckboxChange: props.handleCheckboxChange,
				selectedCollections: props.selectedCollections,
			} : {
				params: {
					id: userData.id,
				},
				countLabel: (<div>
					{props.queryParams.collectionId
						? t.rich("itemsInCollection", {
								count: formatter.number(
									props.itemsData?.totalItems || 0
								),
								number: (chunks) => (
									<NumberWrapper>{chunks}</NumberWrapper>
								),
								collection: userData.collections.find(
									(collection: any) =>
										collection.id === props.queryParams.collectionId
								)?.name,
								collections: (chunks) => (
									<CollectionWrapper>
										{chunks}
									</CollectionWrapper>
								),
						  })
						: t.rich("likedItemsCount", {
								count: formatter.number(
									props.itemsData?.totalItems || 0
								),
								number: (chunks) => (
									<NumberWrapper>{chunks}</NumberWrapper>
								),
						  })}
				</div>)
			})}
		/>
	);
}

type ProfileListItem = {
	label: any;
	icon: IconType;
	className?: string;
	index: number;
	id?: string;
	count?: any;
	textValue?: string;
	createdAt?: Date;
	updatedAt?: Date;
} & Omit<ListboxItemProps, "children">;

function ProfileListbox({
	data,
	listItems,
	className,
	...props
}: {
	data: any;
	listItems: ProfileListItem[];
} & Omit<ListboxProps, "children">) {
	const t = useTranslations("ui");

	return (
		<Listbox
			variant="flat"
			selectionMode="single"
			className={twMerge("flex flex-col py-6", className)}
			aria-label={t("bookmarksListAriaLabel")}
			{...props}
		>
			{listItems.map(
				({
					label,
					icon: Icon,
					className,
					index,
					textValue,
					count,
					...itemProps
				}) => (
					<ListboxItem
						inlist={false}
						key={String(index)}
						shouldHighlightOnFocus
						textValue={textValue}
						aria-label={textValue}
						startContent={<Icon className="shrink-0" />}
						className={twMerge(
							"text-xl gap-4",
							props.selectionMode !== "none" &&
								"data-[selected]:opacity-100 opacity-60 text-xl",
							className
						)}
						{...itemProps}
						description={""}
					>
						<div className="text-xl">{label}</div>
					</ListboxItem>
				)
			)}
		</Listbox>
	);
}

function useProfileCollectionsList(
	displayData: any,
	selectedTab: Set<string>,
	setSelectedTab: any,
	handleCollectionSelect: any,
	search: string,
	selectedCollection: any,
	disabledKeys: Set<string>
): [ProfileListItem[], number] {
	const formatter = useFormatter();
	const t = useTranslations("ui");

	const collectionsItems = Object.keys(displayData.itemsCollections).reduce(
		(acc: { [key: string]: string[] }, itemKey) => {
			for (const collectionId of Object.keys(
				displayData.itemsCollections[itemKey]
			)) {
				if (!acc[collectionId]) {
					acc[collectionId] = [];
				}
				acc[collectionId].push(itemKey);
			}
			return acc;
		},
		{}
	);

	const dataList: ProfileListItem[] = [
		{
			label: (
				<span>
					{t("likedItemsLabel")}
					<span className="text-sm ltr:ml-2 rtl:mr-2 opacity-60">
						(
						{formatter.number(
							Object.keys(displayData.likes).length
						)}
						)
					</span>
				</span>
			),
			textValue: t("likedItemsLabel"),
			count: formatter.number(Object.keys(displayData.likes).length),
			description: t("likedItemsDescription"),
			icon: BsBookmark,
			index: 0,
		},
		...displayData.collections.map(
			(collection: any): ProfileListItem => ({
				label: (
					<span>
						{collection.name}
						<span className="text-sm ltr:ml-2 rtl:mr-2 opacity-60">
							(
							{formatter.number(
								collectionsItems[collection.id]?.length || 0
							)}
							)
						</span>
					</span>
				),
				textValue: collection.name,
				count: formatter.number(
					collectionsItems[collection.id]?.length || 0
				),
				description: collection.description,
				icon: BsCollection,
				id: collection.id,
				index: 0,
				createdAt: collection.createdAt,
				updatedAt: collection.updatedAt,
			})
		),
	];

	const dataListIndexed = dataList.map((item, index) => ({
		...item,
		onPress: () => {
			if (item.id && !selectedTab.has(String(index))) {
				handleCollectionSelect(item.id);
			} else {
				handleCollectionSelect("");
				if (item.id) {
					setSelectedTab(new Set([String(0)]));
				}
			}
		},
		index,
	}));

	const filteredDataList = dataListIndexed.filter(
		(item) =>
			(typeof item.label === "string" &&
				item.label.toLowerCase().includes(search.toLowerCase())) ||
			(typeof item.description === "string" &&
				item.description.toLowerCase().includes(search.toLowerCase()))
	).filter(
		(item) => !disabledKeys.has(String(item.id))
	);

	return [
		filteredDataList,
		dataListIndexed.findIndex((item) => item.id === selectedCollection),
	];
}

function CollectionDropdown({
	selectedCollection,
	loading,
	handleDelete,
	selectedCollectionData,
}: {
	selectedCollection: string;
	loading: boolean;
	handleDelete: any;
	selectedCollectionData: any;
}) {
	const t = useTranslations("ui");
	const formatter = useFormatter();

	return (
		<Dropdown>
			<DropdownTrigger>
				<Button
					isDisabled={!selectedCollection || loading}
					isIconOnly
					size="md"
					className="!p-0"
				>
					<BsThreeDotsVertical />
				</Button>
			</DropdownTrigger>
			<DropdownMenu
				disabledKeys={new Set(["collectionInfo", "editCollection"])}
				onAction={(key) => {
					if (key === "deleteCollection") {
						handleDelete({});
					}
				}}
			>
				<DropdownSection>
					<DropdownItem
						key="collectionInfo"
						isReadOnly
						className="opacity-100"
					>
						{selectedCollectionData && (
							<div className="w-full flex flex-col gap-3">
								<div>
									<div className="text-xs text-black/40 dark:text-white/40 mb-1">
										{t("collectionName")}
									</div>
									<div className="text-sm text-black/80 dark:text-white/80 font-medium">
										{selectedCollectionData?.textValue}
									</div>
								</div>
								<div>
									<div className="text-xs text-black/40 dark:text-white/40 mb-1">
										{t("collectionDescriptionDescription")}
									</div>
									<div className="text-sm text-black/80 dark:text-white/80">
										{selectedCollectionData?.description ||
											t("noDescription")}
									</div>
								</div>
								<div>
									<div className="text-xs text-black/40 dark:text-white/40 mb-1">
										{t("savedItemsLabel")}
									</div>
									<div className="text-sm text-black/80 dark:text-white/80">
										{selectedCollectionData?.count}
									</div>
								</div>
								<div className="flex flex-col gap-0.5 border-t border-black/10 dark:border-white/10 pt-3 mt-1">
									<div className="flex items-center gap-1 text-[11px] text-black/40 dark:text-white/40">
										<span>{t("createdLabel")}</span>
										<span>
											{formatter.relativeTime(
												new Date(
													selectedCollectionData?.createdAt ||
														Date.now()
												),
												Date.now()
											)}
										</span>
									</div>
								</div>
							</div>
						)}
					</DropdownItem>
				</DropdownSection>
				<DropdownItem key="editCollection" startContent={<BsPencil />}>
					{t("editAction")}
				</DropdownItem>
				<DropdownItem
					startContent={<BiTrash />}
					key="deleteCollection"
					color="danger"
				>
					{t("deleteAction")}
				</DropdownItem>
			</DropdownMenu>
		</Dropdown>
	);
}

function ProfileCollectionsList({
	displayData,
	selectedKey,
	setSelectedTab,
	onOpen,
	selectedCollection,
	mainListboxList,
	selectedCollectionIndex,
	setSearch,
	update,
	handleCollectionSelect,
	appendContent,
}: {
	displayData: any;
	selectedKey: string;
	setSelectedTab: any;
	onOpen: any;
	selectedCollection?: string;
	mainListboxList: ProfileListItem[];
	selectedCollectionIndex: number;
	setSearch: any;
	update: any;
	handleCollectionSelect: any;
	appendContent: ReactNode;
}) {
	const t = useTranslations("ui");

	return (
		<ProfileListbox
			disallowEmptySelection
			selectedKeys={selectedKey ? [selectedKey] : []}
			data={displayData}
			className="flex-1 z-10"
			classNames={{
				list: "min-h-80 max-h-80 overflow-y-auto xl:scrollbar-hide hover:scrollbar-default overflow-x-hidden px-6 py-2",
			}}
			itemClasses={{
				base: "px-4",
				wrapper: "overflow-x-hidden",
				description: "truncate",
			}}
			listItems={mainListboxList}
			topContent={
				<div className="px-6">
					<Input
						placeholder={t("searchCollections")}
						className="w-full mb-2"
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>
			}
			bottomContent={
				<div className="flex w-full mt-2 gap-2 px-6">
					<Button
						className="flex-1"
						startContent={<BsPlus className="shrink-0" />}
						size="md"
						onPress={onOpen}
					>
						{t("createCollection")}
					</Button>
					{appendContent}
				</div>
			}
		/>
	);
}

function useDisplayedData(
	data: any,
	session: Session | null,
	isCurrentUser: boolean
) {
	const displayData = {
		...data,
		...(isCurrentUser ? session?.user : {}),
	};

	if (session?.user) {
		if (session?.user?.following[data.id]) {
			displayData.followers[session.user.id] =
				session.user.following[data.id];
		} else {
			delete displayData.followers[session.user.id];
		}
	}

	return displayData;
}
export default function Profile({
	data,
}: {
	data: any;
}) {
	const { data: session, update } = useSession();
	const [loading, setLoading] = useState(false);
	const [selectedTab, setSelectedTab] = useState(new Set(["0"]));
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const t = useTranslations("ui");
	const isCurrentUser = session?.user.id == data.id;
	const [search, setSearch] = useState("");
	const [disabledKeys, setDisabledKeys] = useState<Set<string>>(new Set());
	const displayData: Session["user"] = useDisplayedData(
		data,
		session,
		isCurrentUser
	);

	const props = useItemsList(data);
	const { queryParams: { collectionId: selectedCollection }, handleCollectionSelect } = props;

	const [mainListboxList, selectedCollectionIndex] =
		useProfileCollectionsList(
			displayData,
			selectedTab,
			setSelectedTab,
			props.handleCollectionSelect,
			search,
			selectedCollection,
			disabledKeys
		);

	const { trigger } = useSWRMutation(
		selectedCollection ? `/user/collections/${selectedCollection}` : null,
		fetcherDELETE
	);

	const handleDelete = async (e: any) => {
		setLoading(true);
		try {
			handleCollectionSelect("");
			setDisabledKeys((prev) => {
				const newSet = new Set(prev);
				newSet.add(String(selectedCollection));
				return newSet;
			});
			await trigger();
			await update();
		} catch (error) {
			console.error(error);
		} finally {
			setLoading(false);
		}
	};

	const selectedCollectionData = mainListboxList.find(
		(item) => item.id === selectedCollection
	);

	const selectedKey =
		(selectedCollection && !disabledKeys.has(selectedCollection))
			? String(selectedCollectionIndex)
			: "0"

	const appendContent = (
		<CollectionDropdown
			selectedCollection={selectedCollection || ""}
			loading={loading}
			handleDelete={handleDelete}
			selectedCollectionData={selectedCollectionData}
		/>
	);
	return (
		<PageContainer
			id="main-content"
			className="flex xl:gap-[40px] gap-4 items-start xl:flex-row flex-col"
		>
			<CreateCollectionModal
				onClose={onClose}
				isOpen={isOpen}
				onOpenChange={onOpenChange}
				update={update}
			/>
			<div className="xl:w-96 w-full flex-col gap-6 shrink-0">
				<div className="w-full dark:bg-secondary bg-black/[4%] rounded-2xl flex flex-col">
					<div className="w-full dark:bg-card bg-white rounded-2xl rounded-b-none overflow-hidden flex">
						<div
							className={twMerge(
								"w-1/4 aspect-square",
								!displayData.image &&
									"bg-primary dark:bg-secondary rounded-r-full p-4"
							)}
						>
							<Image
								src={displayData.image ?? `/icons/profile.png`}
								alt={t("userAvatarAlt", {
									name:
										displayData.name ||
										displayData.email ||
										t("genericUser"),
								})}
								width={256}
								height={256}
								objectFit="cover"
								className="w-full h-full object-cover rounded-r-full"
							/>
						</div>
						<div className="w-3/4 flex flex-col p-4 justify-center">
							{displayData.name && (
								<div className="text-xl font-medium text-black/80 dark:text-white/80 flex items-center gap-2">
									{displayData.name}
								</div>
							)}
							<div className="text-sm text-black/60 dark:text-white/60">
								{displayData.email}
							</div>
						</div>
					</div>
					<div className="flex p-6 gap-2">
						{[
							{
								label: t("likedItemsLabel"),
								count:
									"+" +
									Object.keys(displayData.likes).length ||
									0,
							},
							{
								label: t("savedItemsLabel"),
								count:
									Object.keys(displayData.itemsCollections)
										.length || 0,
							},
							{
								label: t("collections"),
								count: displayData.collections.length || 0,
							},
						].map((item) => (
							<div
								key={item.label}
								className="flex flex-col justify-center flex-1"
							>
								<div className="text-2xl font-medium text-black/80 dark:text-white/80">
									{item.count}
								</div>
								<div className="text-sm text-black/60 dark:text-white/60 line-clamp-1">
									{item.label}
								</div>
							</div>
						))}
					</div>
					<div className="hidden xl:flex flex-col flex-1">
						<div className="px-6">
							<Divider />
						</div>
						<ProfileCollectionsList
							displayData={displayData}
							selectedKey={selectedKey}
							setSelectedTab={setSelectedTab}
							onOpen={onOpen}
							selectedCollection={selectedCollection}
							mainListboxList={mainListboxList}
							selectedCollectionIndex={selectedCollectionIndex}
							setSearch={setSearch}
							update={update}
							handleCollectionSelect={handleCollectionSelect}
							appendContent={appendContent}
						/>
						{isCurrentUser && (
							<div className="px-6">
								<Divider className="" />
								<ProfileListbox
									selectionMode="none"
									data={displayData}
									listItems={[
										{
											label: t("settings"),
											icon: BsGear,
										},
										{
											label: t("logout"),
											icon: BsBoxArrowRight,
											className:
												"text-red-500 dark:text-red-500",
										},
									].map((item, index) => ({
										...item,
										index,
									}))}
								/>
							</div>
						)}
					</div>
				</div>
			</div>
			<div className="w-full flex flex-col gap-4">
				<ItemsList
					userData={data}
					props={props}
					extraFilters={
						<div className="flex w-full gap-4 col-span-2 xl:hidden">
							<Autocomplete
								startContent={
									selectedKey === "0" ? (
										<BsBookmark />
									) : (
										<BsCollection />
									)
								}
								selectedKey={selectedKey}
								inputProps={{
									classNames: {
										inputWrapper:
											"bg-white dark:bg-secondary border-small border-black/10 dark:border-white/10 rounded-2xl",
										input: "placeholder:text-black/60 dark:placeholder:text-white/40 text-base xl:text-small",
									},
								}}
							>
								{mainListboxList.map(
									({
										icon: Icon,
										label,
										index,
										textValue,
										onPress,
									}) => (
										<AutocompleteItem
											onPress={() => {
												(onPress as () => void)();
											}}
											textValue={textValue}
											startContent={<Icon />}
											key={index}
										>
											{label}
										</AutocompleteItem>
									)
								)}
							</Autocomplete>
							<Button
								onPress={onOpen}
								aria-label={t("createCollection")}
								isIconOnly
								className="h-full"
							>
								<BsPlus />
							</Button>
							{appendContent}
						</div>
					}
				/>
			</div>
		</PageContainer>
	);
}
