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
import { fetcher, firstNonNullOrEmpty } from "@/lib/utils";
import { Skeleton } from "@/components/nextui/Skeleton";
import { Tooltip } from "@/components/nextui/Tooltip";
import { useDisclosure } from "@nextui-org/react";
import ResourceAuthors from "./ResourceAuthors";
import ResourceDivider from "./ResourceDivider";
import ResourceData from "./ResourceData";
import { FuturePublicationHint } from "./FuturePublicationHint";
import { StudyTypeLabel } from "./StudyTypeLabel";
import { isFuturePublication } from "@/lib/bibliographic-date";
import { Link } from "@/i18n/routing";
import { preloadItemCovers } from "./PdfCover";
import { useFormatter, useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/nextui/Button";
import { cloneElement, useState, useMemo, useId, useRef } from "react";
import CopyButton from "./CopyButton";
import LikeButton from "./LikeButton";
import FullScreenModal from "@/components/nextui/FullScreenModal";
import { CollectionPickerDialog, usePickerAhead } from "../collections/CollectionPicker";
import { useReaderData } from "@/hooks/useReaderData";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import useSWR from "swr";
import { useResourceHref } from "@/hooks/useResourceHref";
import { useOpenScholarUrl } from "@/components/layout/navbar/ReaderSession";
import { openAlexTotals, openScholarList, type OpenScholarList } from "@/lib/links/openscholar-lists";
import { useItemLink } from "@/hooks/useItemLink";
import { hasAnyTag, hasTag } from "@/lib/tags";
import { generateCOinS } from "@/lib/coins";
import { resolveGapMapsByTags } from "@/lib/gapmap-links";
import { useGapMaps } from "@/context/Providers";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { AskAboutButton } from "@/components/features/ai/AskAbout";
import { EvidenceVerdict, useEvidenceRecord, VisualizeButton, type EvidenceRecord } from "@/components/pages/evidence/record-evidence";
import { OpenAccessLabel } from "./OpenAccessLabel";
import { ResourceCover, resourcePdfs } from "./ResourceCover";

export function AddButton({
	itemData,
	revalidateResults,
	collectionId,
	linksInNewTab = false,
}: {
	itemData: Item | ListItem | undefined;
	revalidateResults?: any;
	collectionId?: string;
	linksInNewTab?: boolean;
}) {
	const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
	const { reader } = useReaderData();
	const t = useTranslations("ui");
	const picker = usePickerAhead(itemData?.key);

	return (
		reader && (
			<>
				<CollectionPickerDialog
					itemKey={itemData?.key}
					isOpen={isOpen}
					onOpenChange={onOpenChange}
					onClose={onClose}
					revalidateResults={revalidateResults}
					collectionId={collectionId}
					linksInNewTab={linksInNewTab}
				/>
				<Button
					isIconOnly
					size="sm"
					onPress={() => picker.open(onOpen)}
					onPointerEnter={picker.warm}
					onFocus={picker.warm}
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
 * library holds, and how many OpenAlex lists in all, or the total alone when the library holds none. The first number
 * opens the library's list, the second the whole list in OpenScholar. A direction with nothing on either side is left
 * out.
 */
function CitationCounts({
	itemData,
	linksInNewTab,
}: {
	itemData: Item | ListItem | undefined;
	linksInNewTab: boolean;
}) {
	const t = useTranslations("ui");
	// The reader's chosen language, so the server and the browser write a total the same way.
	const locale = useLocale();
	const resourceHref = useResourceHref();
	const openScholar = useOpenScholarUrl();
	const context: CountContext = {
		t, key: itemData?.key ?? "", links: itemData?.links,
		// OpenAlex's own totals, as of the last import.
		source: openAlexTotals(itemData), resourceHref,
		there: (list) => { const path = openScholarList(itemData, list)?.path; return path ? openScholar(path) : undefined; },
	};
	// A meta-analysis whose analysed studies are known counts those, not every work it cites (the evidence map).
	const evidence = useEvidenceRecord(itemData?.key);
	const counts = [evidence?.analysed ? analysedRow(context, evidence) : referenceRow(context), citationRow(context)].filter((count) => count.held > 0 || (count.total ?? 0) > 0);
	if (counts.length === 0) return null;

	return (
		<div
			data-count-row
			className="flex min-w-0 items-center gap-4 overflow-hidden whitespace-nowrap"
			onClick={(e) => e.stopPropagation()}
		>
			{counts.map((count) => <CountItem key={count.id} count={count} locale={locale} of={t("of")} onOpenAlex={(all) => t("onOpenAlex", { count: all })} linksInNewTab={linksInNewTab} />)}
		</div>
	);
}

type CountContext = {
	t: ReturnType<typeof useTranslations>; key: string; links: (Item | ListItem)["links"]; source: { referencedWorksCount?: number | null; citedByCount?: number | null } | undefined;
	resourceHref: ReturnType<typeof useResourceHref>; there: (list: OpenScholarList) => string | undefined;
};
function referenceRow({ t, key, links, source, resourceHref, there }: CountContext): CountRow {
	return {
		id: "references", icon: ArrowUpRight01Icon, tone: "reference", colour: "text-violet-700 dark:text-violet-300",
		held: links?.cites.length ?? 0, total: source?.referencedWorksCount ?? null,
		here: `${resourceHref(key, { set: { links: "references" } })}#relations-tabs`, there: there("references"),
		label: (count) => t("referenceLabel", { count }),
		words: (held, total) => total === null ? t("referencesHeldOnly", { held }) : t("referencesHeld", { held, total }),
	};
}
/** A meta-analysis's analysed studies: how many the library holds of all it analysed, opening its chain on the evidence map. */
function analysedRow({ t, key }: CountContext, evidence: EvidenceRecord): CountRow {
	const others = (evidence.reviews ?? 0) + (evidence.other ?? 0);
	return {
		id: "analysed", icon: ArrowUpRight01Icon, tone: "reference", colour: "text-violet-700 dark:text-violet-300",
		held: evidence.analysedHere ?? 0, total: evidence.analysed ?? null,
		// Both numbers open the chain: it lists every study it analysed, the ones outside the library too.
		here: `/evidence?paper=${key}`, there: `/evidence?paper=${key}`, thereInside: true,
		label: (count) => t("analysedStudyLabel", { count }),
		words: (held, total) => t("analysedWords", { held, total: total ?? held, others }),
	};
}
function citationRow({ t, key, links, source, resourceHref, there }: CountContext): CountRow {
	return {
		id: "citations", icon: ArrowDownLeft01Icon, tone: "library", colour: "text-accent",
		held: links?.citedBy.length ?? 0, total: source?.citedByCount ?? null,
		here: resourceHref(key, { base: "/citation" }), there: there("citations"),
		label: (count) => t("citationLabel", { count }),
		words: (held, total) => total === null ? t("citationsHeldOnly", { held }) : t("citationsHeld", { held, total }),
	};
}

type CountRow = {
	id: string; icon: typeof ArrowUpRight01Icon; tone: "reference" | "library"; colour: string; held: number; total: number | null;
	here: string; there: string | null | undefined; /** The total opens a page of this library, not Openscholar. */ thereInside?: boolean; label: (count: number) => string; words: (held: number, total: number | null) => string;
};
// A narrow card drops the words; the tooltip and screen readers still get them.
const COUNT_LABEL = "sr-only @[400px]:not-sr-only @[400px]:whitespace-nowrap";
const COUNT_NUMBER = "rounded font-semibold tabular-nums outline-offset-2 hover:underline";
const NEW_TAB = { target: "_blank", rel: "noopener noreferrer" } as const;
// Every count opens a list robots.txt closes (an address with a query, /citation/, or Openscholar's search), so crawlers are told not to follow it.
const CLOSED_LIST = "nofollow";

/** One direction: how many the library holds, linked to its list, and of how many in OpenScholar. */
function CountItem({ count, locale, of, onOpenAlex, linksInNewTab }: { count: CountRow; locale: string; of: string; onOpenAlex: (all: string) => string; linksInNewTab: boolean }) {
	const { icon, tone, colour, held, total, here, label, words } = count;
	// A reference an editor added by hand may not be one OpenAlex lists, so the total is only shown when it holds.
	const all = total !== null && total >= held ? total : null;
	return (
		<CountTooltip tone={tone} icon={icon} text={words(held, all)}>
			<span className={twMerge("inline-flex h-8 shrink-0 items-center gap-1.5 text-xs font-medium", colour)}>
				<HugeiconsIcon icon={icon} className="size-3.5" />
				{held > 0 && <Link href={here} {...(linksInNewTab ? NEW_TAB : {})} rel={linksInNewTab ? `${CLOSED_LIST} ${NEW_TAB.rel}` : CLOSED_LIST} aria-label={words(held, null)} className={COUNT_NUMBER}>{held}</Link>}
				{all !== null && <CountTotal all={all} count={count} locale={locale} of={held > 0 ? of : null} onOpenAlex={onOpenAlex} />}
				<span data-count-label className={twMerge("opacity-70", COUNT_LABEL)}>{label(all ?? held)}</span>
			</span>
		</CountTooltip>
	);
}

/** The source's total. It stands alone when the library holds none of them, where "0 of 12" would read as a broken count. */
function CountTotal({ all, count, locale, of, onOpenAlex }: { all: number; count: CountRow; locale: string; of: string | null; onOpenAlex: (all: string) => string }) {
	const tLabels = useTranslations("item");
	const text = all.toLocaleString(locale);
	return <>
		{of && <span className="opacity-60">{of}</span>}
		{count.there && count.thereInside ? (
			<Link href={count.there} rel={CLOSED_LIST} aria-label={tLabels("label3", { text, count: count.label(all) })} className={COUNT_NUMBER}>{text}</Link>
		) : count.there ? (
			<a href={count.there} target="_blank" rel={`${CLOSED_LIST} noreferrer`} aria-label={tLabels("label4", { text, count: count.label(all), value: onOpenAlex(text) })} className={COUNT_NUMBER}>{text}</a>
		) : (
			<span className="font-semibold tabular-nums">{text}</span>
		)}
	</>;
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
	linksInNewTab,
}: {
	itemData: Item | ListItem | undefined;
	isLoading: boolean;
	revalidateResults?: any;
	collectionId?: string;
	itemHref?: string;
	/** In the chat, where a page change would close it. */
	linksInNewTab: boolean;
}) {
	const t = useTranslations("ui");

	return (
		<div className="p-2 bg-black/[4%] dark:bg-secondary rounded-b-xl shrink-0">
			<Skeleton isLoaded={!isLoading} className="w-full rounded-2xl">
				<div className="w-full rounded-2xl flex flex-row items-center">
					<CitationCounts itemData={itemData} linksInNewTab={linksInNewTab} />
					<div className="ml-auto flex shrink-0 items-center justify-end z-10 gap-2 pl-2">
						{itemHref && (
							<Button
								as={Link}
								href={itemHref}
								{...(linksInNewTab ? NEW_TAB : {})}
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
							linksInNewTab={linksInNewTab}
						/>
						<LikeButton
							itemData={itemData}
							revalidateResults={revalidateResults}
						/>
						<AskAboutButton item={itemData} />
						<VisualizeButton item={itemData} compact />
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

type ArticleProps = {
	titleId: string;
	finalItemData: Item | ListItem | undefined;
	finalIsLoading: boolean;
	gapMapHref: string | null;
	abstract: boolean;
	abstractText: string | false | null | undefined;
	t: ReturnType<typeof useTranslations<"ui">>;
	tNav: ReturnType<typeof useTranslations<"nav">>;
	format: ReturnType<typeof useFormatter>;
};

/**
 * What the record is and, where it has been checked, how it held up: read first, above the title. A library with AI types its
 * records, so a card still loading there keeps the line's place.
 */
function ResourceFacts({ item, isLoading }: { item: Item | ListItem | undefined; isLoading: boolean }) {
	const typesRecords = useLibraryConfig().ai.providers.some((provider) => provider.enabled);
	const record = useEvidenceRecord(item?.key);
	if (isLoading && typesRecords) return <Skeleton isLoaded={false} className="-mb-2 h-7 w-40 rounded-2xl" />;
	const reading = item?.reading;
	if (!record?.verdict && !reading) return null;
	return (
		<div className="-mb-2 flex min-h-7 items-center gap-3 text-sm">
			{reading && <StudyTypeLabel reading={reading} />}
			<EvidenceVerdict item={item} />
		</div>
	);
}

/** The record's date, when it has one a reader can read. */
function ResourceDate({ item, format }: { item: Item | ListItem | undefined; format: ArticleProps["format"] }) {
	const value = item?.datePublished;
	if (!value || isNaN(new Date(value).getTime())) return null;
	return (
		<>
			<ResourcePublishedDate value={value} format={format} />
			<ResourceDivider />
		</>
	);
}

/** The record's in-progress, internal and retracted marks. */
function ResourceFlags({ item, t }: { item: Item | ListItem | undefined; t: ArticleProps["t"] }) {
	const tLabels = useTranslations("item");
	const { content } = useLibraryConfig();
	return (
		<>
			{hasAnyTag(item?.tags, content.tags.comingSoon) && (
				<span className="bg-black/10 border border-accent rounded-lg px-4 py-1 text-accent font-medium w-full @[720px]:w-auto text-center">
					{t("inProgress")}
				</span>
			)}
			{hasAnyTag(item?.tags, content.tags.internal) && (
				<span className="bg-black/10 border border-danger rounded-lg px-4 py-1 text-danger font-medium w-full @[720px]:w-auto text-center">
					{t("internal")}
				</span>
			)}
			{hasTag(item?.tags, "Retracted") && (
				<span className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-danger bg-danger/10 px-4 py-1 font-medium text-danger @[720px]:w-auto">
					<HugeiconsIcon icon={Alert02Icon} className="size-4" />
					{tLabels("retractedPublication")}
				</span>
			)}
		</>
	);
}

/** Who wrote it, when, and whether it can be read, with the gap map it belongs to and its marks. */
function ResourceByline({ titleId, finalItemData, gapMapHref, t, tNav, format }: ArticleProps) {
	return (
		<div className="flex w-full gap-1 items-center flex-wrap text-black/70 dark:text-white/70">
			{gapMapHref && (
				<span className="inline-flex items-center gap-1.5 text-accent font-medium">
					<HugeiconsIcon icon={MapsIcon} className="size-3.5 shrink-0" />
					<span id={`${titleId}-gap-map`}>{tNav("gapMap")}</span>
				</span>
			)}
			<ResourceAuthors itemData={finalItemData} />
			<ResourceDivider />
			<ResourceDate item={finalItemData} format={format} />
			<OpenAccessLabel openAccess={finalItemData?.openAccess} />
			<ResourceFlags item={finalItemData} t={t} />
		</div>
	);
}

function ResourceAbstract({ finalItemData, finalIsLoading, abstract, abstractText }: ArticleProps) {
	if (!abstract || !(abstractText || !finalItemData)) return null;
	return (
		<Skeleton isLoaded={!finalIsLoading} className={twMerge("w-full min-h-0 rounded-2xl ", !finalItemData ? "min-h-20" : "min-h-0")}>
			<p className="text-black/60 dark:text-white/60 line-clamp-3 text-lg w-full">{abstractText}</p>
		</Skeleton>
	);
}

/**
 * With a PDF, its cover takes the card's trailing edge: beside everything on a wide card, and beside the byline and abstract
 * on a narrow one, so the title keeps the card's whole width and is never cut shorter than a card without a PDF.
 */
const WITH_COVER =
	"grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_1fr] gap-x-4 gap-y-4 [grid-template-areas:'head_head'_'body_cover'] @[640px]:[grid-template-areas:'head_cover'_'body_cover'] @[720px]:gap-x-6";

function ResourceArticle(props: ArticleProps) {
	const { titleId, finalItemData, finalIsLoading, abstract, abstractText } = props;
	const pdfs = resourcePdfs(finalItemData);
	return (
		<article className={pdfs.length ? WITH_COVER : "flex flex-col gap-4"}>
			{/* Without a cover the two halves are no boxes of their own, and the card is the plain column it always was. */}
			<div className={pdfs.length ? "flex flex-col gap-4 [grid-area:head]" : "contents"}>
				<ResourceFacts item={finalItemData} isLoading={finalIsLoading} />
				<Skeleton isLoaded={!finalIsLoading} className="w-full min-h-8 rounded-2xl">
					<ResourceTitle id={titleId} item={finalItemData} />
				</Skeleton>
			</div>
			<div className={pdfs.length ? "flex flex-col gap-4 [grid-area:body]" : "contents"}>
				<Skeleton isLoaded={!finalIsLoading} className="w-full min-h-8 rounded-2xl">
					<ResourceByline {...props} />
				</Skeleton>
				<ResourceAbstract {...props} />
			</div>
			{pdfs.length > 0 && <ResourceCover pdfs={pdfs} title={finalItemData?.title ?? undefined} parentType={finalItemData?.itemType} short={!abstract || !abstractText} />}
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
			<div className={CARD}>
				{gapMapHref ? (
					<a
						aria-labelledby={`${titleId} ${titleId}-gap-map`}
						href={gapMapHref}
						target="_blank"
						rel="noopener noreferrer"
						className={twMerge(
							CARD_LINK,
							!finalItemData?.key && "!pointer-events-none",
							!finalIsLoading && !finalItemData?.key && "no-data",
							!finalIsLoading && finalItemData?.key && "has-data",
						)}
					/>
				) : (
					<Link
						aria-labelledby={titleId}
						target={openLinksInNewTab ? "_blank" : undefined}
						rel={openLinksInNewTab ? "noopener noreferrer" : undefined}
						{...itemLink}
						className={twMerge(
							CARD_LINK,
							!finalItemData?.key && "!pointer-events-none",
							!finalIsLoading && !finalItemData?.key && "no-data",
							!finalIsLoading && finalItemData?.key && "has-data",
						)}
					/>
				)}
				<div className={CARD_CONTENT}>{article}</div>
			</div>
			<ResourceInteractions
				itemData={finalItemData}
				isLoading={finalIsLoading}
				revalidateResults={revalidateResults}
				collectionId={collectionId}
				itemHref={gapMapHref ? itemTargetHref : undefined}
				linksInNewTab={openLinksInNewTab}
			/>
		</ResourceWrapper>
	);
}

/**
 * The card is one link, laid under what it shows rather than around it, so the controls on a card (a record's check, its study
 * type's explanation) sit beside the link rather than inside it. The pointer goes through the card's text to the link, the
 * skeletons that turn it back on once loaded too, and its hover tints the card behind the text.
 */
const CARD = "group/card relative p-4 @[720px]:p-6 flex-1";
const CARD_LINK = "absolute inset-0 rounded-t-xl transition-colors hover:bg-black/[0.06] dark:hover:bg-black/25";
const CARD_CONTENT = "pointer-events-none relative [&_*]:!pointer-events-none [&_:is(a,button,[tabindex])]:!pointer-events-auto";

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
