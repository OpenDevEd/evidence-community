import { twMerge } from "tailwind-merge";
import { Item, ItemGetResponse, ListItem } from "@/app/api/item/types";
import {
	fetcher,
	firstNonNullOrEmpty,
	setter,
	transformItem,
} from "@/lib/utils";
import { Skeleton } from "@/components/nextui/Skeleton";
import { ModalBody, ModalContent, useDisclosure } from "@nextui-org/react";
import { RelationsType } from "@/types/item";
import ResourceAuthors from "./ResourceAuthors";
import ResourceDivider from "./ResourceDivider";
import ResourceData from "./ResourceData";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/nextui/Button";
import { useState, useEffect, useMemo } from "react";
import CopyButton from "./CopyButton";
import useSWRMutation from "swr/mutation";
import { useSession } from "next-auth/react";
import LikeButton from "./LikeButton";
import { BsMapFill, BsPlus, BsQuote } from "react-icons/bs";
import { TbBlockquote } from "react-icons/tb";
import { IoChevronForward } from "react-icons/io5";
import FullScreenModal from "@/components/nextui/FullScreenModal";
import GenericHeader from "../modals/GenericHeader";
import CollectionsList from "../user/CollectionsList";
import { Session } from "next-auth";
import { useFeatureFlagEnabled, useStatus } from "@/context/Providers";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import DialogModal from "@/components/nextui/DialogModal";
import useSWR from "swr";
import { useQueryState } from "nuqs";
import { useResourceHref } from "@/hooks/useResourceHref";
import { COMING_SOON_TAG, INTERNAL_TAG } from "@/constants/items";
import { hasTag } from "@/lib/tags";
import PrefetchLink from "../PrefetchLink";
import { generateCOinS } from "@/lib/coins";
import { resolveGapMapsByTags } from "@/lib/gapmap-links";
import { useGapMaps } from "@/context/Providers";
import ZoteroRichText from "./ZoteroRichText";
import { ItemTranslationToggle, useItemTranslation } from "@/components/features/translation/ResultsTranslation";
import { SemanticCardAction } from "@/components/features/semantic/SemanticConcepts";

export function AddButton({
	itemData,
	userData,
	revalidateResults,
	collectionId,
}: {
	itemData: Item | ListItem | undefined;
	userData?: Session["user"];
	revalidateResults?: any;
	collectionId?: string;
}) {
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const [loading, setLoading] = useState(false);
	const { trigger } = useSWRMutation(`/user/item/${itemData?.key}`, setter);
	const { data: session, update } = useSession();
	const isUserCollectionsEnabled = useFeatureFlagEnabled("user-collections");
	const t = useTranslations("ui");
	const highlightedCollections = Object.keys(
		itemData ? (session?.user.itemsCollections[itemData.key] ?? {}) : {},
	);
	const onCollectionSelect = async (pressedCollectionId: string) => {
		setLoading(true);
		try {
			const willClose =
				pressedCollectionId === collectionId &&
				highlightedCollections.includes(pressedCollectionId);
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
		session &&
		isUserCollectionsEnabled && (
			<>
				<DialogModal
					size="lg"
					isOpen={isOpen}
					onOpenChange={onOpenChange}
				>
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
											highlightedCollections
										}
										data={session?.user}
										classNames={{
											container: "gap-3",
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
					aria-label={t("addResourceAriaLabel")}
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

function CitationCounts({
	itemData,
	openLinksInNewTab,
}: {
	itemData: Item | ListItem | undefined;
	openLinksInNewTab?: boolean;
}) {
	const t = useTranslations("ui");
	const resourceHref = useResourceHref();
	const relations = itemData?.relations as RelationsType;
	const isOpenAlex = itemData?.groupExternalId === 1;

	const citesCount =
		(Array.isArray(relations?.cites) ? relations.cites.length : 0) +
		(Array.isArray(relations?.referenced_works)
			? relations.referenced_works.length
			: 0);
	const citedByCount =
		(relations?.cited_by || 0) +
		(Array.isArray(relations?.citedBy) ? relations.citedBy.length : 0);

	if (citesCount === 0 && citedByCount === 0) return null;

	return (
		<div
			className="flex items-center gap-2"
			onClick={(e) => e.stopPropagation()}
		>
			{citedByCount > 0 &&
				(isOpenAlex ? (
					<span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-accent/10 dark:bg-accent/20 text-accent text-xs font-medium">
						<BsQuote className="size-3.5" />
						<span>{citedByCount}</span>
						<span className="text-accent/70 hidden @[480px]:inline">
							{t("citationsLowercase")}
						</span>
					</span>
				) : (
					<Link
						href={resourceHref(itemData?.key ?? "", {
							base: "/citation",
						})}
						target={openLinksInNewTab ? "_blank" : undefined}
						rel={
							openLinksInNewTab
								? "noopener noreferrer"
								: undefined
						}
						className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-accent/10 dark:bg-accent/20 text-accent text-xs font-medium hover:bg-accent/20 dark:hover:bg-accent/30 transition-colors"
					>
						<BsQuote className="size-3.5" />
						<span>{citedByCount}</span>
						<span className="text-accent/70 hidden @[480px]:inline">
							{t("citationsLowercase")}
						</span>
						<IoChevronForward className="size-3 opacity-50 ml-0.5" />
					</Link>
				))}
			{citesCount > 0 && (
				<span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/70 text-xs font-medium">
					<TbBlockquote className="size-3.5" />
					<span>{citesCount}</span>
					<span className="opacity-70 hidden @[480px]:inline">
						{t("references").toLowerCase()}
					</span>
				</span>
			)}
		</div>
	);
}

function ResourceInteractions({
	itemData,
	isLoading,
	userData,
	revalidateResults,
	collectionId,
	itemHref,
	openLinksInNewTab,
}: {
	itemData: Item | ListItem | undefined;
	isLoading: boolean;
	userData?: Session["user"];
	revalidateResults?: any;
	collectionId?: string;
	itemHref?: string;
	openLinksInNewTab?: boolean;
}) {
	const t = useTranslations("ui");

	return (
		<div className="p-2 bg-black/[4%] dark:bg-secondary rounded-b-xl shrink-0">
			<Skeleton isLoaded={!isLoading} className="w-full rounded-2xl">
				<div className="w-full rounded-2xl flex flex-row items-center">
					<CitationCounts
						itemData={itemData}
						openLinksInNewTab={openLinksInNewTab}
					/>
					<ItemTranslationToggle itemKey={itemData?.key} />
					<SemanticCardAction itemKey={itemData?.key} />
					<div className="flex-1 flex items-center justify-end z-10 gap-2">
						{itemHref && (
							<Button
								as={Link}
								href={itemHref}
								target={
									openLinksInNewTab ? "_blank" : undefined
								}
								rel={
									openLinksInNewTab
										? "noopener noreferrer"
										: undefined
								}
								size="sm"
								startContent={
									<IoChevronForward className="size-3.5" />
								}
							>
								{t("viewDetails")}
							</Button>
						)}
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

function ResourceArticle({
	finalItemData,
	finalIsLoading,
	gapMapHref,
	abstract,
	abstractText,
	t,
	tNav,
	format,
}: {
	finalItemData: Item | ListItem | undefined;
	finalIsLoading: boolean;
	gapMapHref: string | null;
	abstract: boolean;
	abstractText: string | false | null | undefined;
	t: ReturnType<typeof useTranslations<"ui">>;
	tNav: ReturnType<typeof useTranslations<"nav">>;
	format: ReturnType<typeof useFormatter>;
}) {
	const translation = useItemTranslation(finalItemData?.key);
	const translated = translation && !translation.pending && !translation.showingOriginal ? translation : null;
	return (
		<article className="flex flex-col gap-4">
			<Skeleton
				isLoaded={!finalIsLoading}
				className="w-full min-h-8 rounded-2xl"
			>
				{translated ? (
					<h3 className="text-2xl text-black/80 dark:text-white/80 line-clamp-2">
						{translated.title}
					</h3>
				) : (
					<h3
						dangerouslySetInnerHTML={{
							__html: finalItemData?.title ?? "",
						}}
						className={twMerge(
							"text-2xl text-black/80 dark:text-white/80 line-clamp-2 transition-opacity",
							translation?.pending && "opacity-40 animate-pulse",
						)}
					></h3>
				)}
			</Skeleton>
			<Skeleton
				isLoaded={!finalIsLoading}
				className="w-full min-h-8 rounded-2xl"
			>
				<div className="flex w-full gap-1 items-center flex-wrap">
					{gapMapHref && (
						<span className="inline-flex items-center gap-1.5 text-accent font-medium">
							<BsMapFill className="size-3.5 shrink-0" />
							<span>{tNav("gapMap")}</span>
						</span>
					)}
					<ResourceAuthors itemData={finalItemData} />
					<ResourceDivider />
					{finalItemData?.datePublished &&
						!isNaN(
							new Date(finalItemData.datePublished).getTime(),
						) && (
							<>
								<ResourceData
									element="time"
									datetime={new Date(
										finalItemData.datePublished,
									).toISOString()}
									text={format.dateTime(
										new Date(finalItemData.datePublished),
										{
											dateStyle: "medium",
										},
									)}
									classNames={{
										text: "text-black/60 dark:text-white/60 font-normal",
									}}
								/>
								<ResourceDivider />
							</>
						)}

					{hasTag(finalItemData?.tags, COMING_SOON_TAG) && (
						<span className="bg-black/10 border border-accent rounded-lg px-4 py-1 text-accent font-medium w-full @[720px]:w-auto text-center">
							{t("inProgress")}
						</span>
					)}

					{hasTag(finalItemData?.tags, INTERNAL_TAG) && (
						<span className="bg-black/10 border border-danger rounded-lg px-4 py-1 text-danger font-medium w-full @[720px]:w-auto text-center">
							{t("internal")}
						</span>
					)}
				</div>
			</Skeleton>
			{abstract && (abstractText || !finalItemData) && (
				<Skeleton
					isLoaded={!finalIsLoading}
					className={twMerge(
						"w-full min-h-0 rounded-2xl ",
						!finalItemData ? "min-h-20" : "min-h-0",
					)}
				>
					<ZoteroRichText
						markup={translated?.abstract ?? (abstractText || "")}
						className={twMerge(
							"text-black/60 dark:text-white/60 line-clamp-3 text-lg w-full transition-opacity",
							(translation?.pending || translated?.abstractPending) && "opacity-40 animate-pulse",
						)}
					/>
				</Skeleton>
			)}
		</article>
	);
}

export default function Resource({
	itemData,
	abstract,
	isLoading = false,
	userData,
	revalidateResults,
	collectionId,
	itemKey,
	className,
	as = "li",
	hideUnapi,
	openLinksInNewTab = false,
}: {
	itemData?: Item | ListItem | undefined;
	abstract: boolean;
	isLoading?: boolean;
	userData?: Session["user"];
	revalidateResults?: any;
	collectionId?: string;
	itemKey?: string;
	className?: string;
	as?: "li" | "div";
	hideUnapi?: boolean;
	openLinksInNewTab?: boolean;
}) {
	const [referrer, setReferrer] = useQueryState("referrer");
	const t = useTranslations("ui");
	const tNav = useTranslations("nav");
	const format = useFormatter();
	const router = useRouter();
	const currentPath = usePathname();

	const { data: fetchedItemData, isLoading: fetchedItemDataLoading } =
		useSWR<ItemGetResponse>(itemKey ? `/item/${itemKey}` : null, fetcher, {
			revalidateOnFocus: false,
		});

	const finalItemData = itemData ?? fetchedItemData?.item;
	const finalIsLoading = !itemKey ? isLoading : fetchedItemDataLoading;
	const transformedItem = finalItemData ? transformItem(finalItemData) : null;

	const abstractText =
		finalItemData && firstNonNullOrEmpty(finalItemData, ["abstractNote"]);
	const gapmaps = useGapMaps();
	const matchedGapMaps = useMemo(
		() => resolveGapMapsByTags(finalItemData?.tags, gapmaps),
		[finalItemData?.tags, gapmaps],
	);
	const gapMapHref = matchedGapMaps[0]?.href ?? null;

	const resourceHref = useResourceHref();

	const itemTargetHref = finalItemData?.key
		? resourceHref(finalItemData.key, {
				set: {
					referrer:
						referrer ??
						"/" +
							(currentPath.startsWith("/lib")
								? "lib"
								: currentPath.split("/").slice(1).join("/")),
				},
			})
		: "";

	return (
		<ResourceWrapper
			as={as}
			className={twMerge(
				"@container w-full bg-white dark:bg-white/[4%] rounded-xl flex flex-col not-prose",
				className,
			)}
		>
			{/* add COINs here */}
			{transformedItem && (
				<div
					className="hidden"
					dangerouslySetInnerHTML={{
						__html: generateCOinS(transformedItem),
					}}
				/>
			)}
			{/* unAPI id marker for Zotero */}
			{finalItemData?.key && !hideUnapi && (
				<abbr className="unapi-id" title={finalItemData.key}></abbr>
			)}
			{gapMapHref ? (
				<a
					href={gapMapHref}
					target="_blank"
					rel="noopener noreferrer"
					className={twMerge(
						"p-4 @[720px]:p-6 hover:brightness-90 transition-[filter] flex-1",
						!finalItemData?.key && "!pointer-events-none",
						!finalIsLoading && !finalItemData?.key && "no-data",
						!finalIsLoading && finalItemData?.key && "has-data",
					)}
				>
					<ResourceArticle
						finalItemData={finalItemData}
						finalIsLoading={finalIsLoading}
						gapMapHref={gapMapHref}
						abstract={abstract}
						abstractText={abstractText}
						t={t}
						tNav={tNav}
						format={format}
					/>
				</a>
			) : (
				<PrefetchLink
					href={finalItemData?.key ? itemTargetHref : ""}
					target={openLinksInNewTab ? "_blank" : undefined}
					rel={openLinksInNewTab ? "noopener noreferrer" : undefined}
					className={twMerge(
						"p-4 @[720px]:p-6 hover:brightness-90 transition-[filter] flex-1",
						!finalItemData?.key && "!pointer-events-none",
						!finalIsLoading && !finalItemData?.key && "no-data",
						!finalIsLoading && finalItemData?.key && "has-data",
					)}
				>
					<ResourceArticle
						finalItemData={finalItemData}
						finalIsLoading={finalIsLoading}
						gapMapHref={gapMapHref}
						abstract={abstract}
						abstractText={abstractText}
						t={t}
						tNav={tNav}
						format={format}
					/>
				</PrefetchLink>
			)}
			<ResourceInteractions
				itemData={finalItemData}
				isLoading={finalIsLoading}
				userData={userData}
				revalidateResults={revalidateResults}
				collectionId={collectionId}
				itemHref={gapMapHref ? itemTargetHref : undefined}
				openLinksInNewTab={openLinksInNewTab}
			/>
		</ResourceWrapper>
	);
}

function ResourceWrapper({
	as,
	children,
	className,
}: {
	as: "li" | "div";
	children: React.ReactNode;
	className?: string;
}) {
	const Component = as;
	return <Component className={className}>{children}</Component>;
}
