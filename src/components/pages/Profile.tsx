"use client";

import Image from "next/image";
import {
	BsBookmark,
	BsBoxArrowRight,
	BsCollection,
	BsGear,
	BsPen,
	BsPlus,
} from "react-icons/bs";
import AboutUs from "../icons/AboutUs";
import { Button } from "../nextui/Button";
import Resource from "../features/items/Resource";
import { ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { Skeleton } from "../nextui/Skeleton";
import { useTranslations } from "next-intl";
import { useFormatter } from "next-intl";
import { useSession } from "next-auth/react";
import { Session } from "next-auth";
import { fetcher, buildItemsQuery, setter, defaultParams } from "@/lib/utils";
import useSWRMutation from "swr/mutation";
import { twMerge } from "tailwind-merge";
import { Textarea } from "../nextui/Textarea";
import { Input } from "../nextui/Input";
import {
	AutocompleteItem,
	Divider,
	Listbox,
	ListboxItem,
	ListboxItemProps,
	ListboxProps,
	ModalBody,
	ModalContent,
	SelectItem,
	Tooltip,
} from "@nextui-org/react";
import { Modal, useDisclosure } from "@nextui-org/react";
import GenericHeader from "../features/modals/GenericHeader";
import FullScreenModal from "../nextui/FullScreenModal";
import { Select } from "../nextui/Select";
import {
	COLLECTION_PER_PAGE,
	COLLECTION_VISIBILITY_OPTIONS,
} from "@/constants/user";
import { useModalError } from "@/hooks/useModalError";
import { AnimatePresence } from "framer-motion";
import { Pagination } from "../nextui/Pagination";
import CollectionsList from "../features/user/CollectionsList";
import UserCollection from "../features/user/UserCollection";
import { ResourcesView } from "../features/resources/ResourcesView";
import { CacheContext } from "@/context/Providers";
import { ITEMS_PER_PAGE, SORT_OPTIONS } from "@/constants/items";
import { useParamsState } from "@/hooks/useParamsState";
import { SCOPE_OPTIONS } from "@/constants/items";
import { ItemsGetResponse } from "@/app/api/items/types";
import useSWR from "swr";
import { IconType } from "react-icons/lib";
import PageContainer from "../layout/PageContainer";
import { IoSearch } from "react-icons/io5";
import { Autocomplete } from "../nextui/Autocomplete";
import DialogModal from "../nextui/DialogModal";

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

function ItemsList({
	searchParams,
	data,
	collectionId,
	extraFilters,
}: {
	searchParams: { [key: string]: any };
	data: any;
	collectionId: string | null;
	extraFilters?: ReactNode;
}) {
	const { router, pathname, createQueryString } =
		useParamsState(searchParams);

	const t = useTranslations("ui");
	const formatter = useFormatter();

	const queryParams = defaultParams(searchParams);

	const itemsQuery = buildItemsQuery(queryParams, `/user/items/${data.id}`);

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

	const {
		data: itemsData,
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
		},
	});

	return (
		<ResourcesView
			sort={queryParams.sort}
			search={queryParams.search}
			scope={queryParams.scope}
			handleSearchChange={handleSearchChange}
			handleScopeChange={handleScopeChange}
			handleSortChange={handleSortChange}
			itemsData={itemsData}
			itemsError={itemsError}
			isItemsLoading={isItemsLoading}
			range={queryParams.range}
			handleRangeChange={handleRangeChange}
			pageNumber={queryParams.page}
			handlePageChange={handlePageChange}
			searchParams={searchParams}
			isItemsFetching={isItemsFetching}
			revalidateResults={revalidateResults}
			extraFilters={extraFilters}
			countLabel={
				<div>
					{collectionId
						? t.rich("itemsInCollection", {
								count: formatter.number(
									itemsData?.totalItems || 0
								),
								number: (chunks) => (
									<NumberWrapper>{chunks}</NumberWrapper>
								),
								collection: data.collections.find(
									(collection: any) =>
										collection.id === collectionId
								)?.name,
								collections: (chunks) => (
									<CollectionWrapper>
										{chunks}
									</CollectionWrapper>
								),
						  })
						: t.rich("likedItemsCount", {
								count: formatter.number(
									itemsData?.totalItems || 0
								),
								number: (chunks) => (
									<NumberWrapper>{chunks}</NumberWrapper>
								),
						  })}
				</div>
			}
			queryParams={queryParams}
			params={{
				id: data.id,
			}}
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
	return (
		<Listbox
			variant="flat"
			selectionMode="single"
			className={twMerge("flex flex-col py-6", className)}
			aria-label={"Bookmarks and collections list"}
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
	selectedCollection: any
): [ProfileListItem[], number] {
	const formatter = useFormatter();
	const t = useTranslations("ui");
	const [mainListboxList, selectedCollectionIndex] = useMemo(() => {
		const collectionsItems = Object.keys(
			displayData.itemsCollections
		).reduce((acc: { [key: string]: string[] }, itemKey) => {
			for (const collectionId of Object.keys(
				displayData.itemsCollections[itemKey]
			)) {
				if (!acc[collectionId]) {
					acc[collectionId] = [];
				}
				acc[collectionId].push(itemKey);
			}
			return acc;
		}, {});

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
					item.description
						.toLowerCase()
						.includes(search.toLowerCase()))
		);

		return [
			filteredDataList,
			dataListIndexed.findIndex((item) => item.id === selectedCollection),
		];
	}, [displayData, search]);

	return [mainListboxList, selectedCollectionIndex];
}

function ProfileCollectionsList({
	displayData,
	selectedTab,
	setSelectedTab,
	onOpen,
	selectedCollection,
	mainListboxList,
	selectedCollectionIndex,
	setSearch,
}: {
	displayData: any;
	selectedTab: Set<string>;
	setSelectedTab: any;
	onOpen: any;
	selectedCollection?: string;
	mainListboxList: ProfileListItem[];
	selectedCollectionIndex: number;
	setSearch: any;
}) {
	const t = useTranslations("ui");

	return (
		<ProfileListbox
			disallowEmptySelection
			selectedKeys={
				selectedCollection
					? [String(selectedCollectionIndex)]
					: selectedTab
			}
			onSelectionChange={setSelectedTab as any}
			data={displayData}
			className="flex-1 z-10"
			classNames={{
				list: "min-h-80 max-h-80 overflow-y-auto xl:scrollbar-hide hover:scrollbar-default overflow-x-hidden",
			}}
			itemClasses={{
				wrapper: "overflow-x-hidden",
				description: "truncate",
			}}
			listItems={mainListboxList}
			topContent={
				<Input
					placeholder={t("searchCollections")}
					className="w-full mb-2"
					onChange={(e) => setSearch(e.target.value)}
				/>
			}
			bottomContent={
				<Button
					className="mt-2"
					startContent={<BsPlus />}
					size="md"
					onPress={onOpen}
				>
					{t("createCollection")}
				</Button>
			}
		/>
	);
}

export default function Profile({
	data,
	likedPosts,
	searchParams,
}: {
	data: any;
	likedPosts: any[];
	searchParams: { [key: string]: any };
}) {
	const { data: session, update } = useSession();
	const [selectedTab, setSelectedTab] = useState(new Set(["0"]));
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const { router, pathname, createQueryString } =
		useParamsState(searchParams);
	const t = useTranslations("ui");
	const selectedCollection = searchParams["collectionId"] || "";
	const isCurrentUser = session?.user.id == data.id;
	const [search, setSearch] = useState("");

	const displayData: Session["user"] = useMemo(() => {
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
	}, [data, session]);

	const handleCollectionSelect = useCallback(
		(collectionId: string) => {
			if (collectionId === selectedCollection) {
				router.push(
					createQueryString(pathname, [["collectionId", ""]])
				);
			} else {
				router.push(
					createQueryString(pathname, [
						["collectionId", collectionId],
					])
				);
			}
		},
		[router, pathname, createQueryString]
	);

	const [mainListboxList, selectedCollectionIndex] =
		useProfileCollectionsList(
			displayData,
			selectedTab,
			setSelectedTab,
			handleCollectionSelect,
			search,
			selectedCollection
		);

	const selectedKey = selectedCollection
		? String(selectedCollectionIndex)
		: Array.from(selectedTab)[0];

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
								alt={`${
									displayData.name ?? displayData.email
								}'s profile picture`}
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
					<div className="hidden px-6 xl:flex flex-col flex-1">
						<Divider className="" />
						<ProfileCollectionsList
							displayData={displayData}
							selectedTab={selectedTab}
							setSelectedTab={setSelectedTab}
							onOpen={onOpen}
							selectedCollection={selectedCollection}
							mainListboxList={mainListboxList}
							selectedCollectionIndex={selectedCollectionIndex}
							setSearch={setSearch}
						/>
						{isCurrentUser && (
							<>
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
							</>
						)}
					</div>
				</div>
			</div>
			<div className="w-full flex flex-col gap-4">
				<ItemsList
					data={displayData}
					searchParams={searchParams}
					collectionId={selectedCollection}
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
						</div>
					}
				/>
			</div>
		</PageContainer>
	);
}
