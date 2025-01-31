import { twMerge } from "tailwind-merge";
import { Item } from "@/app/api/item/types";
import { firstNonNullOrEmpty, setter } from "@/lib/utils";
import { Skeleton } from "@/components/nextui/Skeleton";
import {
	ModalBody,
	ModalContent,
	Link as NextUILink,
	useDisclosure,
} from "@nextui-org/react";
import ResourceAuthors from "./ResourceAuthors";
import ResourceDivider from "./ResourceDivider";
import ResourceData from "./ResourceData";
import { Link, useRouter } from "@/i18n/routing";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/nextui/Button";
import { useState, useEffect } from "react";
import CopyButton from "./CopyButton";
import useSWRMutation from "swr/mutation";
import { useSession } from "next-auth/react";
import LikeButton from "./LikeButton";
import { BsPlus } from "react-icons/bs";
import FullScreenModal from "@/components/nextui/FullScreenModal";
import GenericHeader from "../modals/GenericHeader";
import CollectionsList from "../user/CollectionsList";
import { Session } from "next-auth";
import { useStatus } from "@/context/Providers";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import DialogModal from "@/components/nextui/DialogModal";

export function AddButton({
	itemData,
	userData,
	revalidateResults,
	collectionId,
}: {
	itemData: Item | undefined;
	userData?: Session["user"];
	revalidateResults?: any;
	collectionId?: string;
}) {

	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const [loading, setLoading] = useState(false);
	const { trigger } = useSWRMutation(`/user/item/${itemData?.key}`, setter);
	const { data: session, update } = useSession();
	const t = useTranslations("ui");
	const highlightedCollections = Object.keys(
		itemData
			? session?.user
					.itemsCollections[
					itemData.key
			  ] ?? {}
			: {}
	)
	const onCollectionSelect = async (pressedCollectionId: string) => {
		setLoading(true);
		try {
			const willClose = pressedCollectionId === collectionId && highlightedCollections.includes(pressedCollectionId);
			await trigger({ collectionId: pressedCollectionId });
			await Promise.allSettled([
				revalidateResults && revalidateResults(),
				update(),
			]);
			if (willClose) {
				onClose();
			}
		} catch (error) {
			console.error(error);
		} finally {
			setLoading(false);
		}
	};

	return (
		session && (
			<>
				<DialogModal size="lg" isOpen={isOpen} onOpenChange={onOpenChange}>
					<ModalContent>
						<GenericHeader onClose={onClose}>
							{t("selectCollection")}
						</GenericHeader>
						<ModalBody className="p-6 pt-0 gap-6">
							<Skeleton
								className="w-full rounded-2xl"
								isLoaded={!!itemData}
							>
								<div className="flex flex-col gap-4">
									<CollectionsList
										isLoading={loading}
										highlightedCollections={highlightedCollections}
										data={session?.user}
										classNames={{
											container: "grid-cols-2 gap-3",
										}}
										onCollectionSelect={onCollectionSelect}
									/>
								</div>
							</Skeleton>
						</ModalBody>
					</ModalContent>
				</DialogModal>
				<Button
					isIconOnly
					size="sm"
					onPress={onOpen}
					aria-label={"Add Resource to Collection"}
				>
					<BsPlus className="size-5" />
				</Button>
			</>
		)
	);
}

function FixURL(url: string | null) {
	if (!url) return null;
	if (!url.startsWith("https://")) {
		return `https://${url}`;
	}
	return url;
}

function ResourceInteractions({
	itemData,
	isLoading,
	userData,
	revalidateResults,
	collectionId,
}: {
	itemData: Item | undefined;
	isLoading: boolean;
	userData?: Session["user"];
	revalidateResults?: any;
	collectionId?: string;
}) {
	const t = useTranslations("ui");
	const { data } = useSession();
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const status = useStatus();

	const url = FixURL(status?.docsLink);

	return (
		<div className="p-2 bg-black/[4%] dark:bg-secondary rounded-b-xl shrink-0">
			<Skeleton isLoaded={!isLoading} className="w-full rounded-2xl">
				<div className="w-full rounded-2xl flex flex-row items-center">
					{url && itemData?.key && (
						<NextUILink
							showAnchorIcon
							href={url + "/lib/" + itemData?.key}
							className="font-medium text-tertiary-400 shrink-1 px-2"
						>
							<span className="text-black/60 dark:text-white/60 ">
								{t("viewOnDocs", {
									site: url.split("/")[2],
								})}
							</span>
						</NextUILink>
					)}
					<div className="flex-1 flex items-center justify-end z-10 gap-2">
						<AddButton
							itemData={itemData}
							userData={userData}
							revalidateResults={revalidateResults}
							collectionId={collectionId}
						/>
						<LikeButton
							itemData={itemData}
							revalidateResults={revalidateResults}
						/>
						<CopyButton
							itemData={itemData}
							text={t("copyLink")}
							textOnCopy={t("linkCopied")}
							classNames={{
								button: "px-0 min-w-0 aspect-square @[720px]:aspect-auto @[720px]:px-3",
								text: "hidden @[720px]:block",
							}}
						/>
					</div>
				</div>
			</Skeleton>
		</div>
	);
}

export default function Resource({
	itemData,
	abstract,
	isLoading,
	userData,
	revalidateResults,
	collectionId,
}: {
	itemData: Item | undefined;
	abstract: boolean;
	isLoading: boolean;
	userData?: Session["user"];
	revalidateResults?: any;
	collectionId?: string;
}) {
	const t = useTranslations("ui");
	const format = useFormatter();
	const router = useRouter();

	const abstractText =
		itemData && firstNonNullOrEmpty(itemData, ["abstractNote"]);

	const href = `/lib/${itemData?.key ?? ""}`;

	useEffect(() => {
		if (!itemData?.key) return;

		const observer = new IntersectionObserver((entries) => {
			entries.forEach((entry) => {
				if (entry.isIntersecting) {
					console.log("prefetching", href);
					router.prefetch(href, { kind: PrefetchKind.AUTO });
					observer.disconnect();
				}
			});
		});

		const linkElement = document.querySelector(`a[href="${href}"]`);
		if (linkElement) {
			observer.observe(linkElement);
		}

		return () => observer.disconnect();
	}, [href, router, itemData?.key]);

	return (
		<li className="@container w-full bg-white dark:bg-white/[4%] rounded-xl flex flex-col">
			<Link
				href={href}
				className="p-4 @[720px]:p-6 hover:brightness-90 transition-all flex-1"
				onMouseDown={(e) => {
					const url = new URL(href, window.location.href);
					if (
						url.origin === window.location.origin &&
						e.button === 0 &&
						!e.altKey &&
						!e.ctrlKey &&
						!e.metaKey &&
						!e.shiftKey
					) {
						e.preventDefault();
						router.push(href);
					}
				}}
			>
				<article className="flex flex-col gap-4">
					<Skeleton
						isLoaded={!isLoading}
						className="w-full min-h-8 rounded-2xl"
					>
						<h3 className="capitalize text-2xl text-black/80 dark:text-white/80 line-clamp-2">
							{itemData?.title}
						</h3>
					</Skeleton>
					<Skeleton
						isLoaded={!isLoading}
						className="w-full min-h-8 rounded-2xl"
					>
						<div className="flex w-full gap-1 items-center flex-wrap">
							<ResourceAuthors itemData={itemData} />
							<ResourceDivider />
							{itemData?.date &&
								!isNaN(new Date(itemData.date).getTime()) && (
									<>
										<ResourceData
											element="time"
											datetime={new Date(
												itemData.date
											).toISOString()}
											text={format.dateTime(
												new Date(itemData.date),
												{
													dateStyle: "medium",
												}
											)}
											classNames={{
												text: "text-black/60 dark:text-white/60 font-normal",
											}}
										/>
										<ResourceDivider />
									</>
								)}

							{itemData?.tags?.includes("_comingsoon") && (
								<span className="bg-black/10 border border-accent rounded-lg px-4 py-1 text-accent font-medium w-full @[720px]:w-auto text-center">
									{t("inProgress")}
								</span>
							)}
						</div>
					</Skeleton>
					{abstract && (abstractText || !itemData) && (
						<Skeleton
							isLoaded={!isLoading}
							className={twMerge(
								"w-full min-h-0 rounded-2xl ",
								!itemData ? "min-h-20" : "min-h-0"
							)}
						>
							<p className="text-black/60 dark:text-white/60 line-clamp-3 text-lg w-full break-all">
								{abstractText}
							</p>
						</Skeleton>
					)}
				</article>
			</Link>
			<ResourceInteractions
				itemData={itemData}
				isLoading={isLoading}
				userData={userData}
				revalidateResults={revalidateResults}
				collectionId={collectionId}
			/>
		</li>
	);
}
