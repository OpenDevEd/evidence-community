"use client";

import Image from "next/image";
import { BsPen, BsPlus } from "react-icons/bs";
import AboutUs from "../icons/AboutUs";
import { Button } from "../nextui/Button";
import Resource from "../features/items/Resource";
import { ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { Skeleton } from "../nextui/Skeleton";
import { useTranslations } from "next-intl";
import { useFormatter } from "next-intl";
import { useSession } from "next-auth/react";
import { Session } from "next-auth";
import { fetcher, buildItemsQuery, setter } from "@/lib/utils";
import useSWRMutation from "swr/mutation";
import { twMerge } from "tailwind-merge";
import { Textarea } from "../nextui/Textarea";
import { Input } from "../nextui/Input";
import {
	ModalBody,
	ModalContent,
	SelectItem,
	Tooltip,
} from "@nextui-org/react";
import { Modal, useDisclosure } from "@nextui-org/react";
import GenericHeader from "../features/modals/GenericHeader";
import AIModal from "../nextui/AIModal";
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
			onClick={handleClick}
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
		<AIModal size="sm" isOpen={isOpen} onOpenChange={onOpenChange}>
			<ModalContent className={errorClassName}>
				<GenericHeader onClose={onClose}>
					Create Collection
				</GenericHeader>
				<ModalBody className="pb-6 pt-0">
					<div ref={containerRef} className="flex flex-col w-full">
						<p className="text-sm text-black/60 dark:text-white/60 mb-6 text-center">
							A collection is a group of resources that you want
							to keep together.
						</p>
						<form
							onSubmit={handleSubmit}
							className="flex flex-col gap-3"
						>
							<Input
								autoComplete="off"
								autoFocus
								label="Name"
								name="name"
								placeholder="Collection Name"
							/>
							<Textarea
								autoComplete="off"
								label="Description"
								name="description"
								color="secondary"
								placeholder="Collection Description"
							/>
							<Select
								name="private"
								placement="left"
								label="Visibility"
								color="tertiary"
								className="min-w-full"
								items={COLLECTION_VISIBILITY_OPTIONS}
								disallowEmptySelection
								defaultSelectedKeys={[
									COLLECTION_VISIBILITY_OPTIONS[0].key,
								]}
							>
								{(item: any) => (
									<SelectItem key={item.key}>
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
								Create
							</Button>
						</form>
					</div>
				</ModalBody>
			</ModalContent>
		</AIModal>
	);
}

function NumberWrapper({ children }: { children: ReactNode }) {
	return <span className="text-xl font-medium text-black/80 dark:text-white/80">{children}</span>;
}

function CollectionWrapper({ children }: { children: ReactNode }) {
	return <span className="text-sm text-black/60 dark:text-white/60">{children}</span>;
}

function ItemsList({
	searchParams,
	data,
	collectionId,
}: {
	searchParams: { [key: string]: any };
	data: any;
	collectionId: string | null;
}) {
	const { router, pathname, createQueryString } =
		useParamsState(searchParams);

	const collectionsParam = searchParams["collections"];
	const collections = collectionsParam ? collectionsParam.split(",") : [];
	const pageNumber = Number(searchParams["page"]) || 1;
	const sort = searchParams["sort"] || SORT_OPTIONS[0].key;
	const search = searchParams["search"] || "";
	const scope = searchParams["scope"] || SCOPE_OPTIONS[0].key;
	const range = searchParams["range"] || "";
	const t = useTranslations("ui");
	const formatter = useFormatter();

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
	} = useSWR<ItemsGetResponse>(
		buildItemsQuery(
			{
				pageNumber,
				sort,
				collections,
				search,
				scope,
				range,
				collectionId,
			},
			`/user/items/${data.id}`
		),
		fetcher,
		{
			keepPreviousData: true,
			onSuccess: (data) => {
				if (data.totalPages < pageNumber) {
					handlePageChange(data.totalPages);
				}
			},
		}
	);

	return (
		<ResourcesView
			sort={sort}
			search={search}
			scope={scope}
			handleSearchChange={handleSearchChange}
			handleScopeChange={handleScopeChange}
			handleSortChange={handleSortChange}
			itemsData={itemsData}
			itemsError={itemsError}
			isItemsLoading={isItemsLoading}
			range={range}
			handleRangeChange={handleRangeChange}
			pageNumber={pageNumber}
			handlePageChange={handlePageChange}
			countLabel={<div>
				{collectionId ? t.rich("itemsInCollection", {
					count: formatter.number(itemsData?.totalItems || 0),
					number: (chunks) => <NumberWrapper>{chunks}</NumberWrapper>,
					collection: data.collections.find((collection: any) => collection.id === collectionId)?.name,
					collections: (chunks) => <CollectionWrapper>{chunks}</CollectionWrapper>
				}) : t.rich("likedItemsCount", {
					count: formatter.number(itemsData?.totalItems || 0),
					number: (chunks) => <NumberWrapper>{chunks}</NumberWrapper>
				})}
			</div>}
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
	const [currentlyEditing, setCurrentlyEditing] = useState(false);
	const { data: session, update } = useSession();
	const t = useTranslations("ui");
	const formatter = useFormatter();
	const [selectedTab, setSelectedTab] = useState("Liked Posts");
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const { router, pathname, createQueryString } = useParamsState(searchParams);

	const selectedCollection = searchParams["collectionId"] || "";
	const isCurrentUser = session?.user.id == data.id;

	const displayData = useMemo(() => {
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
				router.push(createQueryString(pathname, [["collectionId", ""]]));
			} else {
				router.push(createQueryString(pathname, [["collectionId", collectionId]]));
			}
		},
		[router, pathname, createQueryString]
	);

	return (
		<div className="w-full max-w-[96rem] px-1 xl:px-3.5 flex gap-2 items-start">
			<CreateCollectionModal
				onClose={onClose}
				isOpen={isOpen}
				onOpenChange={onOpenChange}
				update={update}
			/>
			<div className="w-96 flex flex-col gap-4 shrink-0">
				<div className="w-full dark:bg-secondary bg-black/[4%] rounded-2xl">
					<div className="w-full dark:bg-card bg-white rounded-2xl rounded-b-none overflow-hidden flex">
						<div className="w-1/4 aspect-square">
							{displayData.image ? (
								<Image
									src={displayData.image}
									alt={displayData.name ?? "Profile Picture"}
									width={256}
									height={256}
									objectFit="cover"
									className="w-full h-full object-cover rounded-r-full"
								/>
							) : (
								<div className="w-full h-full bg-primary dark:bg-secondary flex items-center justify-center rounded-r-full">
									<AboutUs className="size-1/2 fill-white" />
								</div>
							)}
						</div>
						<div className="w-3/4 flex flex-col p-4 justify-center">
							<div className="text-xl font-medium text-black/80 dark:text-white/80 flex items-center gap-2">
								{displayData.name ?? "____________________"}
							</div>
							<div className="text-sm text-black/60 dark:text-white/60">
								Joined in{" "}
								{new Date(displayData.createdAt).getFullYear()}
							</div>
						</div>
					</div>
					<div className="w-full flex flex-col p-4 gap-4">
						<div className="flex gap-4">
							<div className="flex-1 flex flex-col items-center dark:bg-card bg-white rounded-2xl p-4">
								<div className="text-xl font-medium text-black/80 dark:text-white/80 flex items-center gap-2">
									{Object.keys(displayData.followers).length}
								</div>
								<div className="text-sm text-black/60 dark:text-white/60">
									Followers
								</div>
							</div>
							<div className="flex-1 flex flex-col items-center dark:bg-card bg-white rounded-2xl p-4">
								<div className="text-xl font-medium text-black/80 dark:text-white/80 flex items-center gap-2">
									{Object.keys(displayData.following).length}
								</div>
								<div className="text-sm text-black/60 dark:text-white/60">
									Following
								</div>
							</div>
						</div>
						<div className="flex flex-col gap-2">
							<div className="text-xl font-medium text-black/80 dark:text-white/80 flex items-center gap-2">
								About me
							</div>
							<div className="text-sm text-black/60 dark:text-white/60 min-h-16 break-words">
								{displayData.description ??
									<span className="italic opacity-50">No description provided</span>}
							</div>
						</div>
						{session?.user?.id !== displayData.id ? (
							<FollowButton
								displayData={displayData}
								session={session}
								update={update}
							/>
						) : (
							<Button>
								{currentlyEditing ? "Save" : "Edit Profile"}
							</Button>
						)}
					</div>
				</div>

				<div className="w-full flex flex-col gap-4 dark:bg-secondary bg-black/[4%] rounded-2xl p-4">
					<div className="w-full flex flex-col gap-4">
						<div className="text-xl font-medium text-black/80 dark:text-white/80 flex items-center gap-2">
							Collections
							<span className="text-sm text-black/60 dark:text-white/60 rtl:mr-auto rtl:ml-auto">
								{displayData.collections.length}
							</span>
							{isCurrentUser && (
								<UserCollection onClick={onOpen} />
							)}
						</div>
						<CollectionsList
							highlightedCollections={selectedCollection ? [selectedCollection] : []}
							onCollectionSelect={handleCollectionSelect}
							data={displayData}
						/>
					</div>
				</div>
			</div>
			<div className="w-full flex flex-col gap-4">
				<div className="flex w-full dark:bg-card bg-white rounded-xl overflow-hidden hidden">
					{["Liked Posts", "Recommendations Feed"].map(
						(tab: string) => (
							<Button
								key={tab}
								size="sm"
								radius="none"
								color={
									selectedTab === tab ? "accent" : "default"
								}
								variant="light"
								onClick={() => setSelectedTab(tab)}
							>
								{tab}
							</Button>
						)
					)}
				</div>
				<ItemsList
					data={displayData}
					searchParams={searchParams}
					collectionId={selectedCollection}
				/>
			</div>
		</div>
	);
}
