import { CitationControl } from "./CitationControl";
import { useAuthorProfiles } from "@/lib/authors/use-author-profiles";
import { HugeiconsIcon, type IconSvgElement } from "@/components/icons/Hugeicon";
import {
	Add01Icon,
	Alert02Icon,
	ArrowDownLeft01Icon,
	ArrowRight01Icon,
	ArrowUpRight01Icon,
	CalendarClockIcon,
	MapsIcon,
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
import { FuturePublicationHint } from "./FuturePublicationHint";
import { isFuturePublication } from "@/lib/bibliographic-date";
import { Link } from "@/i18n/routing";
import { preloadItemCovers } from "./PdfCover";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/nextui/Button";
import { cloneElement, useState, useMemo, useId, useRef } from "react";
import CopyButton from "./CopyButton";
import LikeButton from "./LikeButton";
import FullScreenModal from "@/components/nextui/FullScreenModal";
import GenericHeader from "../modals/GenericHeader";
import CollectionsList from "../user/CollectionsList";
import { useReaderData } from "@/hooks/useReaderData";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import DialogModal from "@/components/nextui/DialogModal";
import useSWR from "swr";
import { useResourceHref } from "@/hooks/useResourceHref";
import { useOpenScholarUrl } from "@/components/layout/navbar/ReaderSession";
import { openScholarList, type OpenScholarList } from "@/lib/links/openscholar-lists";
import { useItemLink } from "@/hooks/useItemLink";
import { hasAnyTag, hasTag } from "@/lib/tags";
import { generateCOinS } from "@/lib/coins";
import { resolveGapMapsByTags } from "@/lib/gapmap-links";
import { useGapMaps } from "@/context/Providers";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

export function AddButton({
	itemData,
	revalidateResults,
	collectionId,
}: {
	itemData: Item | ListItem | undefined;
	revalidateResults?: any;
	collectionId?: string;
}) {
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const [loading, setLoading] = useState(false);
	const { reader, data, refresh } = useReaderData();
	const t = useTranslations("ui");
	const highlightedCollections = itemData ? (data?.itemCollections[itemData.key] ?? []) : [];
	const onCollectionSelect = async (pressedCollectionId: string) => {
		setLoading(true);
		try {
			const willClose =
				pressedCollectionId === collectionId &&
				highlightedCollections.includes(pressedCollectionId);
			if (!itemData) return;
			const response = await setter(`/reader/collections/${pressedCollectionId}/items`, { arg: { itemKey: itemData.key } });
			if (!response.ok) throw new Error(`Collection change failed with HTTP ${response.status}`);
			await Promise.allSettled([
				revalidateResults && revalidateResults(),
				refresh(),
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
		reader && (
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
										collections={data?.collections ?? []}
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

/**
 * A record's references (what it cites) and citations (who cites it), each as "held of total": how many this
 * library holds, and how many OpenAlex lists in all. The first number opens the library's list, the second the
 * whole list in OpenScholar. A direction with nothing on either side is left out.
 */
function CitationCounts({
	itemData,
}: {
	itemData: Item | ListItem | undefined;
}) {
	const t = useTranslations("ui");
	const resourceHref = useResourceHref();
	const openScholar = useOpenScholarUrl();
	const key = itemData?.key ?? "";
	// OpenAlex's own totals, as of the last import.
	const source = itemData?.citationMetrics?.[0];
	const there = (list: OpenScholarList) => { const path = openScholarList(itemData, list)?.path; return path && openScholar(path); };
	const counts = [
		{
			id: "references", icon: ArrowUpRight01Icon, tone: "reference" as const, colour: "text-violet-700 dark:text-violet-300",
			held: itemData?.links?.cites.length ?? 0, total: source?.referencedWorksCount ?? null,
			here: `${resourceHref(key, { set: { links: "references" } })}#relations-tabs`, there: there("references"),
			label: (count: number) => t("referenceLabel", { count }),
			words: (held: number, total: number | null) => total === null ? t("referencesHeldOnly", { held }) : t("referencesHeld", { held, total }),
		},
		{
			id: "citations", icon: ArrowDownLeft01Icon, tone: "library" as const, colour: "text-accent",
			held: itemData?.links?.citedBy.length ?? 0, total: source?.citedByCount ?? null,
			here: resourceHref(key, { base: "/citation" }), there: there("citations"),
			label: (count: number) => t("citationLabel", { count }),
			words: (held: number, total: number | null) => total === null ? t("citationsHeldOnly", { held }) : t("citationsHeld", { held, total }),
		},
	].filter((count) => count.held > 0 || (count.total ?? 0) > 0);
	if (counts.length === 0) return null;

	// A narrow card drops the words; the tooltip and screen readers still get them.
	const labelClassName = "sr-only @[400px]:not-sr-only @[400px]:whitespace-nowrap";
	const number = "rounded font-semibold tabular-nums outline-offset-2 hover:underline";
	return (
		<div
			data-count-row
			className="flex min-w-0 items-center gap-4 overflow-hidden whitespace-nowrap"
			onClick={(e) => e.stopPropagation()}
		>
			{counts.map(({ id, icon, tone, colour, held, total, here, there, label, words }) => {
				// A reference an editor added by hand may not be one OpenAlex lists, so the total is only shown when it holds.
				const all = total !== null && total >= held ? total : null;
				return (
					<CountTooltip key={id} tone={tone} icon={icon} text={words(held, all)}>
						<span className={twMerge("inline-flex h-8 shrink-0 items-center gap-1.5 text-xs font-medium", colour)}>
							<HugeiconsIcon icon={icon} className="size-3.5" />
							{held > 0 ? <Link href={here} className={number}>{held}</Link> : <span className="font-semibold tabular-nums">{held}</span>}
							{all !== null && <>
								<span className="opacity-60">{t("of")}</span>
								{there ? <a href={there} target="_blank" rel="noreferrer" className={number}>{all.toLocaleString()}</a> : <span className="font-semibold tabular-nums">{all.toLocaleString()}</span>}
							</>}
							<span data-count-label className={twMerge("opacity-70", labelClassName)}>{label(all ?? held)}</span>
						</span>
					</CountTooltip>
				);
			})}
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
	icon,
	text,
	children,
}: {
	tone: keyof typeof COUNT_TOOLTIP_TONES;
	icon: IconSvgElement;
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
					<HugeiconsIcon icon={icon} className="size-3.5" />
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
	revalidateResults,
	collectionId,
	itemHref,
}: {
	itemData: Item | ListItem | undefined;
	isLoading: boolean;
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

function ResourcePublishedDate({
	value,
	format,
}: {
	value: string;
	format: ReturnType<typeof useFormatter>;
}) {
	const date = new Date(value);
	const isFuture = isFuturePublication({ datePublished: value });
	const published = (
		<ResourceData
			element="time"
			datetime={date.toISOString()}
			text={format.dateTime(date, { dateStyle: "medium", timeZone: "UTC" })}
			startContent={
				isFuture && (
					<HugeiconsIcon
						icon={CalendarClockIcon}
						className="size-4 shrink-0 text-black/60 dark:text-white/60"
						aria-hidden="true"
					/>
				)
			}
			classNames={{
				container: "gap-1.5",
				text: "text-black/60 dark:text-white/60 font-normal",
			}}
		/>
	);
	return isFuture ? (
		<FuturePublicationHint>{published}</FuturePublicationHint>
	) : (
		published
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
								<ResourcePublishedDate
									value={finalItemData.datePublished}
									format={format}
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
	const t = useTranslations("ui");
	const tNav = useTranslations("nav");
	const format = useFormatter();

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

	// A loading card may still hold the previous results' keys, and a new tab cannot use this page's prefetch cache.
	const itemLink = useItemLink(finalItemData, {
		fullPrefetch: !finalIsLoading && !openLinksInNewTab && (position ?? Infinity) < FULL_PREFETCH_CARDS,
	});
	const itemTargetHref = itemLink.href;
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
					{...itemLink}
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
