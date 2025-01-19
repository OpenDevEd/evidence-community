import { twMerge } from "tailwind-merge";
import { Item } from "@/app/api/item/types";
import { firstNonNullOrEmpty, setter } from "@/lib/utils";
import { Skeleton } from "@/components/nextui/Skeleton";
import {
	ModalBody,
	ModalContent,
	Link as NextUILink, useDisclosure
} from "@nextui-org/react";
import ResourceAuthors from "./ResourceAuthors";
import ResourceDivider from "./ResourceDivider";
import ResourceData from "./ResourceData";
import { Link, useRouter } from "@/i18n/routing";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/nextui/Button";
import { useState } from "react";
import CopyButton from "./CopyButton";
import useSWRMutation from "swr/mutation";
import { useSession } from "next-auth/react";
import LikeButton from "./LikeButton";
import { BsPlus } from "react-icons/bs";
import AIModal from "@/components/nextui/AIModal";
import GenericHeader from "../modals/GenericHeader";
import CollectionsList from "../user/CollectionsList";
import { Session } from "next-auth";
import { useStatus } from "@/context/Providers";

function AddButton({
	itemData,
	userData,
}: {
	itemData: Item | undefined;
	userData?: Session["user"];
}) {
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const [loading, setLoading] = useState(false);
	const { trigger } = useSWRMutation(`/user/item/${itemData?.key}`, setter);
	const { data: session, update } = useSession();
	const t = useTranslations("ui");
	const onCollectionSelect = async (collectionId: string) => {
		setLoading(true);
		try {
			await trigger({ collectionId });
			await update();
		} catch (error) {
			console.error(error);
		} finally {
			setLoading(false);
		}
	};

	return (
		session && (
			<>
				<AIModal size="lg" isOpen={isOpen} onOpenChange={onOpenChange}>
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
										highlightedCollections={
											Object.keys(itemData ? (session?.user.itemsCollections[itemData.key] ?? {}) : {})
										}
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
				</AIModal>
				<Button isIconOnly size="sm" onPress={onOpen}>
					<BsPlus className="size-5" />
				</Button>
			</>
		)
	);
}

function FixURL( url: string | null ) {
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
}: {
	itemData: Item | undefined;
	isLoading: boolean;
	userData?: Session["user"];
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
					{(url && itemData?.key) && (
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
					</NextUILink>)}
					<div className="flex-1 flex items-center justify-end z-10 gap-2">
						<AddButton itemData={itemData} userData={userData} />
						<LikeButton itemData={itemData} />
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
}: {
	itemData: Item | undefined;
	abstract: boolean;
	isLoading: boolean;
	userData?: Session["user"];
}) {
	const t = useTranslations("ui");
	const format = useFormatter();

	const abstractText =
		itemData && firstNonNullOrEmpty(itemData, ["abstractNote"]);

	const router = useRouter();

	return (
		<div className="@container w-full bg-white dark:bg-white/[4%] rounded-xl flex flex-col">
			<Link
				href={`/lib/${itemData?.key ?? ""}`}
				className="p-4 @[720px]:p-6 flex flex-col gap-4 hover:brightness-90 transition-all flex-1"
				onClick={(e) => {
					if (!itemData?.key)
						e.preventDefault();
				}}
			>
				<Skeleton
					isLoaded={!isLoading}
					className="w-full min-h-8 rounded-2xl"
				>
					<h1 className="capitalize text-2xl text-black/80 dark:text-white/80 line-clamp-2">
						{itemData?.title}
					</h1>
				</Skeleton>
				<Skeleton
					isLoaded={!isLoading}
					className="w-full min-h-8 rounded-2xl"
				>
					<div className="flex w-full gap-2 items-center flex-wrap">
						<ResourceAuthors itemData={itemData} />
						<ResourceDivider />
						{itemData?.date &&
							!isNaN(new Date(itemData.date).getTime()) && (
								<>
									<ResourceData
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
							<div className="bg-accent rounded-lg px-4 py-1 text-white/80 font-medium w-full @[720px]:w-auto text-center">
								{t("inProgress")}
							</div>
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
			</Link>
			<ResourceInteractions itemData={itemData} isLoading={isLoading} userData={userData} />
		</div>
	);
}
