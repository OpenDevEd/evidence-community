import { CitationControl } from "./CitationControl";
import { useAuthorProfiles } from "@/lib/authors/use-author-profiles";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import {
	Add01Icon,
	Alert02Icon,
	ArrowRight01Icon,
	MapsIcon,
	QuoteUpIcon,
} from "@hugeicons/core-free-icons";
import { twMerge } from "@/lib/tw-merge";
import { Item, ItemGetResponse, ListItem } from "@/app/api/item/types";
import { fetcher, firstNonNullOrEmpty, setter } from "@/lib/utils";
import { Skeleton } from "@/components/nextui/Skeleton";
import { Tooltip } from "@/components/nextui/Tooltip";
import { ModalBody, ModalContent, useDisclosure } from "@nextui-org/react";
import ResourceAuthors from "./ResourceAuthors";
import ResourceDivider from "./ResourceDivider";
import ResourceData from "./ResourceData";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { markFullyPrefetched } from "@/components/features/newlib/RefreshPrefetchedItem";
import { preloadItemCovers } from "./PdfCover";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/nextui/Button";
import { cloneElement, useState, useEffect, useMemo, useId, useRef } from "react";
import CopyButton from "./CopyButton";
import useSWRMutation from "swr/mutation";
import { useSession } from "next-auth/react";
import LikeButton from "./LikeButton";
import FullScreenModal from "@/components/nextui/FullScreenModal";
import GenericHeader from "../modals/GenericHeader";
import CollectionsList from "../user/CollectionsList";
import { Session } from "next-auth";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import DialogModal from "@/components/nextui/DialogModal";
import useSWR from "swr";
import { useQueryState } from "nuqs";
import { useResourceHref } from "@/hooks/useResourceHref";
import { hasAnyTag, hasTag } from "@/lib/tags";
import { generateCOinS } from "@/lib/coins";
import { resolveGapMapsByTags } from "@/lib/gapmap-links";
import { useGapMaps } from "@/context/Providers";
import {
	useLibraryConfig,
	useLibraryFeature,
} from "@/context/LibraryConfigProvider";

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
	const isUserCollectionsEnabled = useLibraryFeature("userCollections");
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
					<HugeiconsIcon icon={Add01Icon} className="size-5" />
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
}: {
	itemData: Item | ListItem | undefined;
}) {
	const t = useTranslations("ui");
	const resourceHref = useResourceHref();
	const citesCount = itemData?.links?.cites.length ?? 0;
	const citedByCount = itemData?.links?.citedBy.length ?? 0;
	// A source that counts no citations has nothing to show.
	const sourceMetrics = (itemData?.citationMetrics ?? []).filter(
		(metric) => (metric.citedByCount ?? 0) > 0,
	);

	if (citesCount === 0 && citedByCount === 0 && sourceMetrics.length === 0) {
		return null;
	}

	// Below 720px the buttons beside these counts lose their labels, so the
	// counts do too; the tooltip and screen readers still get the words.
	const labelClassName = "sr-only @[720px]:not-sr-only @[720px]:whitespace-nowrap";
	// Only the library citations open a page, so only they look like a button;
	// the other counts are coloured text.
	const statClassName = "inline-flex items-center gap-1.5 h-8 px-1.5 text-xs font-medium";
	return (
		<div
			data-count-row
			className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap"
			onClick={(e) => e.stopPropagation()}
		>
			{citedByCount > 0 && (
				<CountTooltip
					tone="library"
					text={`${citedByCount} ${t("libraryCitationLabel", { count: citedByCount })}`}
				>
					<Link
						href={resourceHref(itemData?.key ?? "", {
							base: "/citation",
						})}
						className="inline-flex shrink-0 items-center gap-1.5 h-8 px-3 rounded-xl bg-accent/10 dark:bg-accent/20 text-accent text-xs font-medium hover:bg-accent/20 dark:hover:bg-accent/30 transition-colors"
					>
						<HugeiconsIcon icon={QuoteUpIcon} className="size-3.5" />
						<span>{citedByCount}</span>
						<span data-count-label className={twMerge("text-accent/70", labelClassName)}>
							{t("libraryCitationLabel", { count: citedByCount })}
						</span>
						<HugeiconsIcon
							icon={ArrowRight01Icon}
							className="size-3 opacity-50 ml-0.5"
						/>
					</Link>
				</CountTooltip>
			)}
			{citesCount > 0 && (
				<CountTooltip
					tone="reference"
					text={`${citesCount} ${t("referenceLabel", { count: citesCount })}`}
				>
					<span
						className={twMerge(
							statClassName,
							"shrink-0 text-violet-700 dark:text-violet-300",
						)}
					>
						<HugeiconsIcon icon={QuoteUpIcon} className="size-3.5" />
						<span>{citesCount}</span>
						<span data-count-label className={labelClassName}>
							{t("referenceLabel", { count: citesCount })}
						</span>
					</span>
				</CountTooltip>
			)}
			{sourceMetrics.map((metric) => (
				<CountTooltip
					key={metric.sourceConnectionKey}
					tone="source"
					text={`${metric.citedByCount} ${metric.sourceLabel} ${t("citationsLowercase")}`}
				>
					<span
						className={twMerge(
							statClassName,
							"min-w-0 text-cyan-700 dark:text-cyan-300",
						)}
					>
						<HugeiconsIcon
							icon={QuoteUpIcon}
							className="size-3.5 shrink-0"
						/>
						<span>{metric.citedByCount}</span>
						<span data-count-label className={twMerge(labelClassName, "@[720px]:truncate")}>
							{metric.sourceLabel} {t("citationsLowercase")}
						</span>
					</span>
				</CountTooltip>
			))}
		</div>
	);
}

// Each tooltip wears the colours of the count it explains. The tint is layered
// over an opaque background so the card never shows through.
const COUNT_TOOLTIP_TONES = {
	library:
		"bg-white dark:bg-secondary bg-[linear-gradient(theme(colors.accent.DEFAULT/0.12),theme(colors.accent.DEFAULT/0.12))] dark:bg-[linear-gradient(theme(colors.accent.DEFAULT/0.2),theme(colors.accent.DEFAULT/0.2))] text-accent",
	reference:
		"bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
	source:
		"bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
};

/**
 * A count's words are hidden on narrow cards, cut short with an ellipsis, or
 * clipped by the row when the counts beside it take the room.
 */
function countLabelIsShortened(trigger: HTMLElement | null) {
	const label = trigger?.querySelector<HTMLElement>("[data-count-label]");
	if (!label || label.clientWidth <= 1 || label.scrollWidth > label.clientWidth) {
		return true;
	}
	const row = label.closest<HTMLElement>("[data-count-row]");
	return Boolean(
		row &&
			label.getBoundingClientRect().right >
				row.getBoundingClientRect().right + 0.5,
	);
}

/** Shows the count's full wording only when the card cannot. */
function CountTooltip({
	tone,
	text,
	children,
}: {
	tone: keyof typeof COUNT_TOOLTIP_TONES;
	text: string;
	children: React.ReactElement<{ ref?: React.Ref<HTMLElement> }>;
}) {
	const triggerRef = useRef<HTMLElement>(null);
	const [isOpen, setOpen] = useState(false);
	return (
		<Tooltip
			isOpen={isOpen}
			onOpenChange={(open) =>
				setOpen(open && countLabelIsShortened(triggerRef.current))
			}
			content={
				<span className="inline-flex items-center gap-1.5">
					<HugeiconsIcon icon={QuoteUpIcon} className="size-3.5" />
					{text}
				</span>
			}
			classNames={{
				content: twMerge(
					"rounded-xl border-0 px-3 py-1.5 text-xs font-medium shadow-md",
					COUNT_TOOLTIP_TONES[tone],
				),
			}}
		>
			{cloneElement(children, { ref: triggerRef })}
		</Tooltip>
	);
}

function ResourceInteractions({
	itemData,
	isLoading,
	userData,
	revalidateResults,
	collectionId,
	itemHref,
}: {
	itemData: Item | ListItem | undefined;
	isLoading: boolean;
	userData?: Session["user"];
	revalidateResults?: any;
	collectionId?: string;
	itemHref?: string;
}) {
	const t = useTranslations("ui");

	return (
		<div className="p-2 bg-black/[4%] dark:bg-secondary rounded-b-xl shrink-0">
			<Skeleton isLoaded={!isLoading} className="w-full rounded-2xl">
				<div className="w-full rounded-2xl flex flex-row items-center">
					<CitationCounts itemData={itemData} />
					<div className="ml-auto flex shrink-0 items-center justify-end z-10 gap-2 pl-2">
						{itemHref && (
							<Button
								as={Link}
								href={itemHref}
								onPointerEnter={() => preloadItemCovers(itemData)}
								onFocus={() => preloadItemCovers(itemData)}
								onTouchStart={() => preloadItemCovers(itemData)}
								size="sm"
								startContent={
									<HugeiconsIcon
										icon={ArrowRight01Icon}
										className="size-3.5"
									/>
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
						<CitationControl item={itemData} />
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

function ResourceTitle({
	id,
	item,
}: {
	id: string;
	item: Item | ListItem | undefined;
}) {
	const tItemType = useTranslations("itemType");
	const title =
		item?.title?.trim() ||
		(item ? `${tItemType(item.itemType)} ${item.key}` : "");
	return (
		<h3
			id={id}
			dangerouslySetInnerHTML={{ __html: title }}
			className="text-2xl text-black/80 dark:text-white/80 line-clamp-2"
		/>
	);
}

function ResourceArticle({
	titleId,
	finalItemData,
	finalIsLoading,
	gapMapHref,
	abstract,
	abstractText,
	t,
	tNav,
	format,
}: {
	titleId: string;
	finalItemData: Item | ListItem | undefined;
	finalIsLoading: boolean;
	gapMapHref: string | null;
	abstract: boolean;
	abstractText: string | false | null | undefined;
	t: ReturnType<typeof useTranslations<"ui">>;
	tNav: ReturnType<typeof useTranslations<"nav">>;
	format: ReturnType<typeof useFormatter>;
}) {
	const { content } = useLibraryConfig();

	return (
		<article className="flex flex-col gap-4">
			<Skeleton
				isLoaded={!finalIsLoading}
				className="w-full min-h-8 rounded-2xl"
			>
				<ResourceTitle id={titleId} item={finalItemData} />
			</Skeleton>
			<Skeleton
				isLoaded={!finalIsLoading}
				className="w-full min-h-8 rounded-2xl"
			>
				<div className="flex w-full gap-1 items-center flex-wrap">
					{gapMapHref && (
						<span className="inline-flex items-center gap-1.5 text-accent font-medium">
							<HugeiconsIcon
								icon={MapsIcon}
								className="size-3.5 shrink-0"
							/>
							<span id={`${titleId}-gap-map`}>
								{tNav("gapMap")}
							</span>
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

					{hasAnyTag(
						finalItemData?.tags,
						content.tags.comingSoon,
					) && (
						<span className="bg-black/10 border border-accent rounded-lg px-4 py-1 text-accent font-medium w-full @[720px]:w-auto text-center">
							{t("inProgress")}
						</span>
					)}

					{hasAnyTag(finalItemData?.tags, content.tags.internal) && (
						<span className="bg-black/10 border border-danger rounded-lg px-4 py-1 text-danger font-medium w-full @[720px]:w-auto text-center">
							{t("internal")}
						</span>
					)}

					{hasTag(finalItemData?.tags, "Retracted") && (
						<span className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-danger bg-danger/10 px-4 py-1 font-medium text-danger @[720px]:w-auto">
							<HugeiconsIcon
								icon={Alert02Icon}
								className="size-4"
							/>
							Retracted publication
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
					<p className="text-black/60 dark:text-white/60 line-clamp-3 text-lg w-full">
						{abstractText}
					</p>
				</Skeleton>
			)}
		</article>
	);
}

// A result list's first screen holds 2 cards in list view and 4 in grid view at 1440×900, and 2 on a phone.
// These cards prefetch their whole item page, so a click opens it without waiting on the server.
// Next.js prefetches a link only once it nears the screen, so a phone still loads only the cards it shows.
const FULL_PREFETCH_CARDS = 4;

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
	position,
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
	/** The card's place in a result list, counting from 0. */
	position?: number;
}) {
	const titleId = useId();
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

	const sourceItemData = itemData ?? fetchedItemData?.item;
	const { creators } = useAuthorProfiles(sourceItemData?.creators);
	const finalItemData = sourceItemData
		? { ...sourceItemData, creators: creators ?? sourceItemData.creators }
		: undefined;
	const finalIsLoading = !itemKey ? isLoading : fetchedItemDataLoading;

	const abstractText =
		finalItemData && firstNonNullOrEmpty(finalItemData, ["abstractNote"]);
	const gapmaps = useGapMaps();
	const matchedGapMaps = useMemo(
		() => resolveGapMapsByTags(sourceItemData?.tags, gapmaps),
		[sourceItemData?.tags, gapmaps],
	);
	const gapMapHref = matchedGapMaps[0]?.href ?? null;

	const resourceHref = useResourceHref();

	// A loading card may still hold the previous results' keys, and a new tab cannot use this page's prefetch cache.
	const fullPrefetch = Boolean(
		finalItemData?.key &&
			!finalIsLoading &&
			!openLinksInNewTab &&
			(position ?? Infinity) < FULL_PREFETCH_CARDS,
	);
	const prepare = () => preloadItemCovers(finalItemData);
	const fullPrefetchKey = fullPrefetch ? finalItemData?.key : undefined;
	useEffect(() => {
		if (fullPrefetchKey) markFullyPrefetched(fullPrefetchKey);
	}, [fullPrefetchKey]);
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
	const article = (
		<ResourceArticle
			titleId={titleId}
			finalItemData={finalItemData}
			finalIsLoading={finalIsLoading}
			gapMapHref={gapMapHref}
			abstract={abstract}
			abstractText={abstractText}
			t={t}
			tNav={tNav}
			format={format}
		/>
	);

	return (
		<ResourceWrapper
			as={as}
			className={twMerge(
				"@container w-full bg-white dark:bg-white/[4%] rounded-xl flex flex-col not-prose",
				className,
			)}
		>
			{/* add COINs here */}
			{finalItemData && (
				<div
					className="hidden"
					dangerouslySetInnerHTML={{
						__html: generateCOinS(finalItemData),
					}}
				/>
			)}
			{/* unAPI id marker for Zotero */}
			{finalItemData?.key && !hideUnapi && (
				<abbr className="unapi-id" title={finalItemData.key}></abbr>
			)}
			{gapMapHref ? (
				<a
					aria-labelledby={`${titleId} ${titleId}-gap-map`}
					href={gapMapHref}
					target="_blank"
					rel="noopener noreferrer"
					className={twMerge(
						"p-4 @[720px]:p-6 hover:brightness-90 transition-all flex-1",
						!finalItemData?.key && "!pointer-events-none",
						!finalIsLoading && !finalItemData?.key && "no-data",
						!finalIsLoading && finalItemData?.key && "has-data",
					)}
				>
					{article}
				</a>
			) : (
				<Link
					aria-labelledby={titleId}
					target={openLinksInNewTab ? "_blank" : undefined}
					rel={openLinksInNewTab ? "noopener noreferrer" : undefined}
					href={finalItemData?.key ? itemTargetHref : ""}
					prefetch={fullPrefetch || undefined}
					onPointerEnter={prepare}
					onFocus={prepare}
					onTouchStart={prepare}
					className={twMerge(
						"p-4 @[720px]:p-6 hover:brightness-90 transition-all flex-1",
						!finalItemData?.key && "!pointer-events-none",
						!finalIsLoading && !finalItemData?.key && "no-data",
						!finalIsLoading && finalItemData?.key && "has-data",
					)}
				>
					{article}
				</Link>
			)}
			<ResourceInteractions
				itemData={finalItemData}
				isLoading={finalIsLoading}
				userData={userData}
				revalidateResults={revalidateResults}
				collectionId={collectionId}
				itemHref={gapMapHref ? itemTargetHref : undefined}
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
