"use client";

import { useEvidenceRecord } from "@/components/pages/evidence/record-evidence";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import {
	Alert02Icon,
	ArrowRight01Icon,
	Building03Icon,
	Folder01Icon,
	Mortarboard01Icon,
	ArrowUpRight01Icon,
	LicenseIcon,
} from "@hugeicons/core-free-icons";
import { licenceComplete, licenceLabel, licenceTermsUrl, recordLicenceSchema, type RecordLicence } from "@/lib/licences";
import { normalizeAccessDate } from "@/lib/admin/field-contract";
import { parseBibliographicDate } from "@/lib/bibliographic-date";
import { escapeHtml } from "@/lib/escape-html";
import { Item, ItemGetResponse, Author } from "@/app/api/item/types";
import PageContainer from "@/components/layout/PageContainer";
import { Card } from "@/components/nextui/Card";
import { RelationsType } from "@/types/item";
import { siDoi } from "simple-icons";
import { CrossrefIcon } from "@/components/icons/CrossrefIcon";
import { ZenodoIcon } from "@/components/icons/ZenodoIcon";
import { useFormatter, useTranslations, useLocale } from "next-intl";
import { AuthorAvatar } from "@/components/authors/AuthorAvatar";
import { Divider, Spinner } from "@nextui-org/react";
import { Skeleton } from "@/components/nextui/Skeleton";
import CopyButton from "@/components/features/newlib/CopyButton";
import { Button } from "@/components/nextui/Button";
import { Collection } from "@/app/api/collections/types";
import type { FacetsGetResponse } from "@/app/api/facets/types";
import { twMerge } from "@/lib/tw-merge";
import { CountryDisplay } from "@/components/features/newlib/CountryDisplay";
import Attachment, { HeldPdf } from "@/components/features/items/Attachment";
import VectorRelations from "@/components/features/newlib/VectorRelations";
import {
	fetcher,
	getExtraValues,
	localizeOrUseIfCapitalized,
} from "@/lib/utils";
import Relations from "@/components/features/newlib/Relations";
import { planRelationTabs } from "@/components/features/newlib/relation-tabs";
import { DownloadButton } from "@/components/features/newlib/DownloadModal";
import AiWrapper from "@/components/features/newlib/AiWrapper";
import ZoteroDropdown from "@/components/features/newlib/ZoteroDropdown";
import LinkWithParams from "../LinkWithParams";
import { HierarchyTree } from "@/components/typography/HierarchyTree";
import { Link } from "@/i18n/routing";
import { serializeSearchParams } from "@/lib/searchParams";
import { HOVER_CARD_CLOSE_DELAY, HOVER_CARD_DELAY, Tooltip } from "@/components/nextui/Tooltip";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import { useOpenScholarUrl } from "@/components/layout/navbar/ReaderSession";
import { openAlexWorkOf, openScholarList, type OpenScholarList } from "@/lib/links/openscholar-lists";
import LikeButton from "../items/LikeButton";
import { AddButton } from "../items/Resource";
import {
	createContext,
	Fragment,
	use,
	useCallback,
	useEffect,
	useState,
	useMemo,
} from "react";
import {
	useLibraryConfig,
	useLibraryFeature,
} from "@/context/LibraryConfigProvider";
import { useQueryState } from "nuqs";
import ItemHeader from "@/components/features/newlib/ItemHeader";
import ItemTitle from "@/components/features/newlib/ItemTitle";
import { COUNTRIES, getSafeReferrer } from "@/constants/misc";
import { useInstitutionCountryCodes } from "@/lib/use-institution-countries";
import {
	isPublishedLink,
	isPublishedNote,
	isVisiblePdfAttachment,
} from "@/lib/attachment-visibility";
import { hasTag, recordPublishTags } from "@/lib/tags";
import useSWR from "swr";
import { type DoiDisplayLink } from "@opendeved/doi-sync-core/display";
import { buildPublicationDisplay } from "@/lib/publication/publication-display-adapter";
import { InstitutionLogo } from "@/components/library/LibraryIdentity";
import { findInstitutionWithLogo } from "@/config/library-config/institutions";
import Image from "next/image";
import { getCanonicalWebsiteItemUrl } from "@/lib/canonical-item-url";
import { selectPublicItemDetails } from "@/lib/public-item-details";
import { CitationPanel } from "@/components/features/items/CitationControl";
import { canCiteItem } from "@/lib/citation-formats";
import { ItemPropertyRowWrapper } from "@/components/features/newlib/ItemPropertyRow";
import BrandIcon from "@/components/icons/BrandIcon";
import { useAuthorProfiles } from "@/lib/authors/use-author-profiles";
import type { AuthorProfile } from "@/lib/authors/profiles";
import { AuthorProfileHover } from "@/components/authors/AuthorProfileHover";
import { creatorDisplayName } from "@/lib/creator-display-name";
import { isOpenAlexWorkProvider } from "@/lib/source-providers";
import { ItemTopics } from "@/components/topics/ItemTopics";

export const LoadingContext = createContext<{ loading: boolean }>({
	loading: false,
});

interface ItemRowProps {
	icon: React.ReactNode;
	title?: string;
	subtitle?: React.ReactNode;
}

function ItemRow({ icon, title, subtitle }: ItemRowProps) {
	const showSkeleton = !title;

	return (
		<div className="px-4 w-full">
			<Skeleton isLoaded={!showSkeleton} className="rounded-2xl w-full">
				{/* One line of text sits level with the icon's middle. More than one, a line under the title too, starts at the icon's top. */}
				<div className="flex items-start gap-3">
					{icon}
					<div className="flex min-w-0 flex-col self-center">
						<div className="text-base font-medium text-black/80 dark:text-white/80 text-wrap-anywhere">
							{title || "-"}
						</div>
						{subtitle}
					</div>
				</div>
			</Skeleton>
		</div>
	);
}

function formatAuthor(author: Author) {
	if (author.name) return author.name;
	return [author.lastName, author.firstName].filter(Boolean).join(", ");
}

interface SidebarCardProps {
	title: string;
	count?: number;
	children: React.ReactNode;
	classNames?: {
		card?: string;
		titleWrapper?: string;
		title?: string;
		count?: string;
		content?: string;
	};
	color?: "card" | "transparent";
}
function SidebarCard({
	title,
	count,
	children,
	classNames,
	color = "card",
}: SidebarCardProps) {
	return (
		<Card
			color={color}
			className={twMerge("p-4 px-0 pb-0", classNames?.card)}
		>
			<div
				className={twMerge(
					"flex justify-between items-center gap-2 mb-4 px-4",
					classNames?.titleWrapper,
				)}
			>
				<h3
					className={twMerge(
						"text-lg font-medium",
						classNames?.title,
					)}
				>
					{title}
				</h3>
				{count && (
					<div
						className={twMerge(
							"text-sm text-black/60 dark:text-white/60",
							classNames?.count,
						)}
					>
						{count}
					</div>
				)}
			</div>
			<div
				className={twMerge(
					"flex flex-col gap-4 max-h-96 overflow-y-auto pb-4 overflow-x-hidden text-wrap-anywhere",
					classNames?.content,
				)}
			>
				{children}
			</div>
		</Card>
	);
}

/** Where the author worked for this record, with each institution's country. */
function AuthorAffiliations({
	affiliations,
}: {
	affiliations: readonly { display_name?: string; country_code?: string }[];
}) {
	const tLabels = useTranslations("item");
	if (affiliations.length === 0) return null;
	return (
		<motion.div
			className="w-full flex flex-col gap-2"
			initial={{ opacity: 0, y: 10 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ delay: 0.3 }}
		>
			<h4 className="text-sm font-medium text-black/70 dark:text-white/70">
				{tLabels("affiliations")}
			</h4>
			{affiliations.map((institution, idx) => (
				<AuthorAffiliation
					key={idx}
					index={idx}
					institution={institution}
				/>
			))}
		</motion.div>
	);
}

/** One affiliation; it filters the search to that institution, like the record's own institutions. */
function AuthorAffiliation({
	institution,
	index: idx,
}: {
	institution: { display_name?: string; country_code?: string };
	index: number;
}) {
	const tLabels = useTranslations("item");
	const link = useInstitutionFilterLink(institution.display_name);
	return (
		<LinkWithParams {...link} className="block w-full opacity-100">
			<motion.div
				className={`w-full flex items-center gap-2 p-2 rounded-xl bg-black/5 dark:bg-white/5${link.href ? " transition-colors hover:bg-black/10 dark:hover:bg-white/10" : ""}`}
				initial={{ opacity: 0, x: -20 }}
				animate={{ opacity: 1, x: 0 }}
				transition={{
					delay: 0.4 + idx * 0.1,
					type: "spring",
					stiffness: 100,
				}}
			>
				<div className="flex-1">
					<p className="text-sm text-black dark:text-white">
						{institution.display_name}
					</p>
					{institution.country_code && (
						<motion.div
							className="flex items-center gap-1 mt-1"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							transition={{ delay: 0.5 + idx * 0.1 }}
						>
							<div className="w-4 h-3 rounded-sm overflow-hidden shadow-sm">
								<Image
									unoptimized
									src={`https://flagcdn.com/${institution.country_code.toLowerCase()}.svg`}
									alt={institution.country_code}
									className="w-full h-full object-cover"
									width={16}
									height={12}
								/>
							</div>
							<span className="text-xs text-black/60 dark:text-white/60">
								{tLabels("label", { value: COUNTRIES[institution.country_code], country_code: institution.country_code })}
							</span>
						</motion.div>
					)}
				</div>
			</motion.div>
		</LinkWithParams>
	);
}

function ItemAuthor({
	author,
	profile,
	countryOf,
}: {
	author?: Author;
	profile?: AuthorProfile;
	countryOf?: (institution: string) => string | undefined;
}) {
	const [referrer] = useQueryState("referrer");
	const t = useTranslations("creatorType");
	const tUI = useTranslations("ui");
	const creatorTypeLabel = author ? t(author?.creatorType) : undefined;
	// Search indexes the saved creator; the profile supplies its current display.
	const fullName = author ? creatorDisplayName(author) : undefined;
	const displayName =
		profile?.name ?? (author ? formatAuthor(author) : undefined);

	const isAuthorFilterEnabled = useLibraryFeature("authorFilter");
	// The country belongs to the institution name, set once for the library.
	const affiliations = (author?.institutions ?? []).map((entry) => ({
		...entry,
		country_code:
			entry.country_code ?? countryOf?.(entry.display_name ?? ""),
	}));
	const affiliationCount = affiliations.length;

	const subtitle = (
		<>
			<div className="flex items-center gap-2">
				{creatorTypeLabel && (
					<div className="text-xs text-black/60 dark:text-white/60">
						{creatorTypeLabel}
					</div>
				)}
				{affiliationCount > 0 && (
					<div className="text-xs text-black/40 dark:text-white/40">
						{affiliationCount} {tUI("itemAffiliationsCount")}
					</div>
				)}
			</div>
		</>
	);

	const row = (
		<LinkWithParams
			href={isAuthorFilterEnabled ? getSafeReferrer(referrer) : undefined}
			params={
				fullName && isAuthorFilterEnabled
					? { author: fullName, referrer: referrer ?? undefined }
					: {}
			}
			className="opacity-100"
		>
			<ItemRow
				icon={
					<AuthorAvatar
						src={profile?.photo ?? undefined}
						name={displayName ?? "-"}
						size="sm"
						className={
							profile
								? "size-9 shrink-0"
								: "text-lg text-accent bg-accent/10 brightness-150 shrink-0"
						}
					/>
				}
				title={displayName}
				subtitle={subtitle}
			/>
		</LinkWithParams>
	);

	if (profile) {
		return (
			<AuthorProfileHover
				profile={profile}
				// The profile says where the author works now. The record says
				// where they worked when they wrote it.
				details={
					affiliationCount > 0 ? (
						<AuthorAffiliations affiliations={affiliations} />
					) : undefined
				}
			>
				{row}
			</AuthorProfileHover>
		);
	}

	return (
		<Tooltip
			color="default"
			delay={HOVER_CARD_DELAY}
			closeDelay={HOVER_CARD_CLOSE_DELAY}
			isDisabled={affiliationCount === 0}
			key={author?.name}
			className="rounded-2xl bg-card_light dark:bg-card"
			placement="left"
			content={
				<div className="py-2 px-1 min-w-author-popover">
					{/* Author Header */}
					<motion.div
						className="flex items-center gap-3 mb-4"
						initial={{ opacity: 0, y: -10 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.2 }}
					>
						<AuthorAvatar
							name={author ? formatAuthor(author) : "-"}
							size="lg"
							className="text-xl text-accent bg-accent/10 brightness-150"
						/>
						<div>
							<motion.h3
								className="font-medium text-lg text-black dark:text-white"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								transition={{ delay: 0.1 }}
							>
								{fullName}
							</motion.h3>
							<motion.p
								className="text-sm text-black/60 dark:text-white/60"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								transition={{ delay: 0.2 }}
							>
								{author?.creatorType
									? t(author?.creatorType)
									: "-"}
							</motion.p>
						</div>
					</motion.div>

					<AuthorAffiliations affiliations={affiliations} />
				</div>
			}
		>
			{row}
		</Tooltip>
	);
}

function ItemAuthors({ item }: { item: Item | undefined }) {
	const { loading } = use(LoadingContext);
	const t = useTranslations("ui");
	const authors = item?.creators as Author[] | undefined;
	const { profiles } = useAuthorProfiles(authors);
	// One lookup for the whole record, not one per author.
	const countryOf = useInstitutionCountryCodes(
		(authors ?? []).flatMap((author) =>
			(author.institutions ?? []).flatMap((entry) =>
				entry.display_name ? [entry.display_name] : [],
			),
		),
	);
	if (!authors?.length && !loading) return null;

	return (
		<SidebarCard title={t("itemAuthorsTitle")} count={authors?.length}>
			{loading
				? Array.from({ length: 3 }).map((_, index) => (
						<ItemAuthor key={index} author={undefined} />
					))
				: authors?.map((author: Author, index: number) => (
						<ItemAuthor
							key={index}
							author={author}
							countryOf={countryOf}
							profile={
								author.authorProfileId
									? profiles.get(author.authorProfileId)
									: undefined
							}
						/>
					))}
		</SidebarCard>
	);
}

/** Where an institution links: the search, filtered to it, when the library shows that filter. */
function useInstitutionFilterLink(institution: string | undefined) {
	const [referrer] = useQueryState("referrer");
	const { filters } = useLibraryConfig();
	const isInstitutionFilterEnabled = filters.institution.mode !== "hidden";
	return {
		href: isInstitutionFilterEnabled ? getSafeReferrer(referrer) : undefined,
		params:
			institution && isInstitutionFilterEnabled
				? {
						institution: [institution],
						referrer: referrer ?? undefined,
					}
				: {},
	};
}

function ItemInstitution({ institution }: { institution?: string }) {
	const { institutions: configuredInstitutions } = useLibraryConfig();
	const link = useInstitutionFilterLink(institution);
	const configuredInstitution = findInstitutionWithLogo(
		configuredInstitutions,
		institution,
	);

	return (
		<LinkWithParams {...link} className="opacity-100">
			<ItemRow
				key={institution}
				icon={
					<InstitutionLogo
						alt=""
						fallback={<HugeiconsIcon icon={Mortarboard01Icon} />}
						logoUrl={configuredInstitution?.logoUrl}
						size="row"
					/>
				}
				title={institution}
			/>
		</LinkWithParams>
	);
}

function ItemInstitutions({ item }: { item: Item | undefined }) {
	const { loading } = use(LoadingContext);
	const t = useTranslations("ui");
	const { filters } = useLibraryConfig();
	const institutions = (item?.institution as string[]) || [];
	if (!institutions?.length && !loading) return null;

	return (
		<SidebarCard
			title={localizeOrUseIfCapitalized(filters.institution.label, t)}
			count={item?.institution?.length}
		>
			{loading
				? Array.from({ length: 3 }).map((_, index) => (
						<ItemInstitution key={index} institution={undefined} />
					))
				: Array.from(new Set(institutions)).map(
						(institution: string) => (
							<ItemInstitution
								key={institution}
								institution={institution}
							/>
						),
					)}
		</SidebarCard>
	);
}

/** Who funds the community, on each of its records: the funders its footer lists, each with its logo and its link. */
function ItemFundingPartners() {
	const { funders } = useLibraryConfig().footer;
	const t = useTranslations("ui");
	if (funders.length === 0) return null;

	return (
		<SidebarCard title={t("fundingPartner")} count={funders.length}>
			{funders.map((funder) => {
				const row = (
					<ItemRow
						icon={
							<InstitutionLogo
								alt=""
								fallback={<HugeiconsIcon icon={Building03Icon} />}
								logoUrl={funder.logoUrl}
								size="row"
							/>
						}
						title={funder.name}
					/>
				);
				// A funder with no site is a name, not a link that goes nowhere.
				return funder.href ? (
					<LinkWithParams key={funder.id} href={funder.href} isExternal className="opacity-100">
						{row}
					</LinkWithParams>
				) : (
					<Fragment key={funder.id}>{row}</Fragment>
				);
			})}
		</SidebarCard>
	);
}

function formatDate(value: string, formatter: ReturnType<typeof useFormatter>) {
	if (!value) return false;
	if (isNaN(new Date(value).getTime())) {
		return value;
	}

	const date = new Date(value);
	const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;

	const returnedDate = formatter.dateTime(date, {
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	return returnedDate;
}

/** Shows a bibliographic date with the precision it was entered with. */
function formatBibliographicDate(
	value: string,
	formatter: ReturnType<typeof useFormatter>,
) {
	const parsed = parseBibliographicDate(value);
	if (parsed.kind !== "parsed") return value;
	if (parsed.precision === "year") return String(parsed.year);
	if (parsed.precision === "month") {
		return formatter.dateTime(new Date(`${parsed.raw}-01T00:00:00Z`), {
			month: "long",
			timeZone: "UTC",
			year: "numeric",
		});
	}
	return formatDate(value, formatter);
}

function formatValue(
	key: string | undefined,
	value: any,
	formatter: ReturnType<typeof useFormatter>,
) {
	if (!key) return value;
	// Access dates are calendar dates. Old records may still hold text such as
	// CURRENT_TIMESTAMP (issue #103); hide anything the admin rule rejects.
	if (key === "accessDate") {
		return typeof value === "string" && normalizeAccessDate(value)
			? formatDate(value, formatter)
			: false;
	}
	if (["createdAt", "updatedAt"].includes(key)) {
		return formatDate(value, formatter);
	}
	// Every other date field is bibliographic ("dateDecided", "filingDate").
	if (key.toLowerCase().includes("date") && typeof value === "string") {
		return formatBibliographicDate(value, formatter);
	}

	return value;
}

function ItemDetailsRow({
	detail,
}: {
	detail?: { label: string; value: any; field?: string };
}) {
	const { loading } = use(LoadingContext);
	const tUI = useTranslations("ui");
	const formatter = useFormatter();
	const formattedValue = detail
		? formatValue(detail.field, detail.value, formatter)
		: undefined;
	const hasValue = ![undefined, null, false, ""].includes(formattedValue);

	return (
		<div className="px-4">
			<Skeleton className="rounded-2xl w-full" isLoaded={!loading}>
				<div className="flex justify-between gap-2">
					<div className="text-base font-medium flex-1">
						<div className="text-sm text-black/60 dark:text-white/60">
							{detail?.label || "-"}
						</div>
						<div className="flex justify-between">
							<div className="text-base">
								{hasValue ? (
									<span
										dangerouslySetInnerHTML={{
											__html: ProcessHTML(
												escapeHtml(
													String(formattedValue),
												),
											),
										}}
										className="text-black/80 dark:text-white/80 text-wrap-anywhere"
									/>
								) : (
									"-"
								)}
							</div>
						</div>
					</div>
					<CopyButton
						textToCopy={formattedValue}
						ariaLabel={tUI("copyField", {
							field: detail?.label ?? "",
						})}
					/>
				</div>
			</Skeleton>
		</div>
	);
}

export function ItemDetails({ item }: { item: Item | undefined }) {
	const { loading } = use(LoadingContext);
	const t = useTranslations("ui");
	const tArticle = useTranslations("article");
	const { identity } = useLibraryConfig();

	if (!item && !loading) return null;
	const details = item ? selectPublicItemDetails(item, identity.baseUrl) : [];
	if (!loading && details.length === 0) return null;

	return (
		<SidebarCard title={t("itemPublicationDetailsTitle")}>
			{loading
				? Array.from({ length: 3 }).map((_, index) => (
						<ItemDetailsRow key={index} detail={undefined} />
					))
				: details.map((detail) => (
						<ItemDetailsRow
							key={detail.label}
							detail={{
								...detail,
								field: detail.label,
								label: tArticle(detail.label),
							}}
						/>
					))}
		</SidebarCard>
	);
}

function ItemTechnical({ item }: { item: Item | undefined }) {
	const tLabels = useTranslations("item");
	const { loading } = use(LoadingContext);
	const t = useTranslations("ui");
	const citationMetrics = item?.citationMetrics ?? [];
	if (citationMetrics.length === 0 && !loading) return null;
	const keyValues = citationMetrics.flatMap((metric) => [
		...(metric.citedByCount === null
			? []
			: [
					{
						key: `${metric.sourceConnectionKey}:citedBy`,
						label: tLabels("label2", { sourceLabel: metric.sourceLabel, value: t("citationsLowercase") }),
						value: metric.citedByCount,
					},
				]),
		...(metric.referencedWorksCount === null
			? []
			: [
					{
						key: `${metric.sourceConnectionKey}:references`,
						label: tLabels("label2", { sourceLabel: metric.sourceLabel, value: t("references").toLowerCase() }),
						value: metric.referencedWorksCount,
					},
				]),
	]);

	return (
		<SidebarCard title={t("itemTechnicalDetailsTitle")} color="card">
			{loading
				? Array.from({ length: 3 }).map((_, index) => (
						<ItemDetailsRow key={index} detail={undefined} />
					))
				: keyValues.map(({ key, label, value }) => (
						<ItemDetailsRow
							key={key}
							detail={{
								label,
								value,
							}}
						/>
					))}
		</SidebarCard>
	);
}

function ItemAbstract({ item }: { item: Item | undefined }) {
	const t = useTranslations("ui");
	return (
		<ItemPropertyRowWrapper
			title={t("itemAbstractTitle")}
			copyText={item?.abstractNote || undefined}
		>
			{/* In its own language's direction: an English abstract on an Arabic page ends with its full stop on the right. */}
			<p dir="auto" className="text-base text-black/60 dark:text-white/60">
				{item?.abstractNote}
			</p>
		</ItemPropertyRowWrapper>
	);
}

function ProcessHTML(html: string) {
	// Single pass: match URLs or bare DOIs
	const combined =
		/(https?:\/\/[^\s<>"{}|\\^`[\]]+)|(10\.\d{4,9}\/[-._;():\w]+)/gi;
	const linkClass = "text-link hover:underline";

	return html.replace(combined, (match, url, doi) => {
		const href = url || `https://doi.org/${doi}`;
		return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="${linkClass}">${match}</a>`;
	});
}

export function ItemCitation({ item }: { item: Item | undefined }) {
	const { citations } = useLibraryConfig();
	if (!citations.enabled || !canCiteItem(item)) return null;
	return (
		<CitationPanel key={item.key} item={item} showHeading completeRecord />
	);
}

type CanonicalWebsiteLink = {
	provider: "website";
	/** `openscholar`: the paper's page on Openscholar. */
	kind: "canonical" | "openscholar";
	label: string;
	value: string;
	url: string;
	iconUrl: string;
};

type IdentifierDisplayLink = DoiDisplayLink | CanonicalWebsiteLink;

function buildCanonicalWebsiteLink(
	item: Item,
	faviconUrl: string,
	baseUrl: string,
): CanonicalWebsiteLink | null {
	const itemUrl = getCanonicalWebsiteItemUrl(item, baseUrl);
	if (!itemUrl) return null;

	return {
		provider: "website",
		kind: "canonical",
		label: "itemIdentifierEvidenceLibrary",
		value: `${itemUrl.host}${itemUrl.pathname}`,
		url: itemUrl.toString(),
		iconUrl: faviconUrl,
	};
}

/** The paper's page on Openscholar, which leads back here: by its OpenAlex work, which Openscholar sends on to its own address. */
function buildOpenScholarPaperLink(item: Item, openScholar: (path: string) => string): CanonicalWebsiteLink | null {
	const work = openAlexWorkOf(item);
	if (!work) return null;
	const url = new URL(openScholar(`/papers/${work}`));
	return { provider: "website", kind: "openscholar", label: "Openscholar", value: `${url.host}${url.pathname}`, url: url.toString(), iconUrl: openScholar("/icon.svg") };
}

function IdentifierLogo({ link }: { link: IdentifierDisplayLink }) {
	return (
		<div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-white">
			{link.provider === "website" ? (
				<span
					role="img"
					aria-label={link.label}
					className="size-5 bg-contain bg-center bg-no-repeat"
					style={{ backgroundImage: `url("${link.iconUrl}")` }}
				/>
			) : link.provider === "crossref" ? (
				<CrossrefIcon className="h-6 w-4" />
			) : link.provider === "zenodo" ? (
				<ZenodoIcon
					className="size-5 text-zenodo"
					aria-label="Zenodo"
				/>
			) : (
				<BrandIcon
					icon={siDoi}
					className="size-5 text-doi"
					aria-label="DOI"
				/>
			)}
		</div>
	);
}

function getIdentifierDisplayTitle(
	link: IdentifierDisplayLink,
	t: ReturnType<typeof useTranslations>,
) {
	if (link.provider === "website") return link.kind === "openscholar" ? link.label : t("itemIdentifierEvidenceLibrary");
	if (link.provider !== "zenodo") return link.label;
	if (link.kind === "record") return t("itemIdentifierArchiveRecord");
	if (link.kind === "concept-record") return t("itemIdentifierConceptRecord");
	if (link.label.toLowerCase().includes("concept")) {
		return t("itemIdentifierConceptDoi");
	}
	return t("itemIdentifierVersionDoi");
}

function ItemIdentifierRow({ link }: { link: IdentifierDisplayLink }) {
	const t = useTranslations("ui");

	return (
		<div className="@container/identifier-row px-4">
			<div className="identifier-line flex items-center gap-3">
				<IdentifierLogo link={link} />
				<div className="identifier-body flex min-w-0 flex-1 flex-col gap-0.5">
					<div className="identifier-text truncate text-sm font-medium leading-tight text-black/80 dark:text-white/80">
						{getIdentifierDisplayTitle(link, t)}
					</div>
					<div className="relative min-w-0 overflow-hidden">
						<a
							href={link.url}
							target="_blank"
							rel="noopener noreferrer"
							// An identifier reads left to right on a right-to-left page too: "10.51878/…", not "…/10.51878".
							dir="ltr"
							className="identifier-text block overflow-hidden whitespace-nowrap pr-5 text-xs leading-tight text-link transition-colors hover:underline"
						>
							{link.value}
						</a>
						<div className="identifier-fade pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-card_light via-card_light/80 to-transparent dark:from-card dark:via-card/80" />
					</div>
				</div>
				<div className="identifier-copy flex shrink-0 items-center">
					<Tooltip color="default" content={t("copy")} placement="top">
						<CopyButton
							textToCopy={link.value}
							ariaLabel={`${t("copy")} ${getIdentifierDisplayTitle(link, t)}`}
							className="size-8 min-w-8 text-black/60 hover:text-accent dark:text-white/60"
						/>
					</Tooltip>
				</div>
			</div>
		</div>
	);
}

function ItemIdentifiers({ item }: { item: Item | undefined }) {
	const t = useTranslations("ui");
	const { identity } = useLibraryConfig();
	const faviconUrl = identity.assets.favicon;
	const openScholar = useOpenScholarUrl();
	const links = useMemo(() => {
		if (!item) return [];

		const doiLinks = buildPublicationDisplay({
			DOI: item.DOI,
			extra: item.extra,
			attachments: item.attachmentsData,
			publicationIdentifiers: item.publicationIdentifiers,
		}).links.links;

		const canonicalLink = buildCanonicalWebsiteLink(
			item,
			faviconUrl,
			identity.baseUrl,
		);
		return [...doiLinks, canonicalLink, buildOpenScholarPaperLink(item, openScholar)].filter((link) => link !== null);
	}, [faviconUrl, identity.baseUrl, item, openScholar]);

	const licence = item ? recordLicence(item.licence) : null;
	if (!links.length && !licence) return null;

	return (
		<SidebarCard title={t("itemIdentifiersTitle")} count={links.length + (licence ? 1 : 0)}>
			{links.map((link) => (
				<ItemIdentifierRow
					key={`${link.provider}-${link.kind}-${link.value}`}
					link={link}
				/>
			))}
			{licence ? <ItemLicenceRow licence={licence} /> : null}
		</SidebarCard>
	);
}

/** A record's licence as its DOI carries it: only a whole one, so a half-written custom licence never shows. */
const recordLicence = (value: unknown) => {
	const licence = recordLicenceSchema.safeParse(value).data;
	return licence && licenceComplete(licence) ? licence : null;
};

/** The licence the record is shared under, beside its DOI, linked to its terms where they have a link. */
function ItemLicenceRow({ licence }: { licence: RecordLicence }) {
	const t = useTranslations("ui");
	const terms = licenceTermsUrl(licence);
	const name = licenceLabel(licence);
	return (
		<div className="@container/identifier-row px-4">
			<div className="identifier-line flex items-center gap-3">
				<div className="flex size-9 shrink-0 self-start items-center justify-center rounded-xl border border-black/10 bg-white text-black/60 shadow-sm dark:border-white/10 dark:bg-white">
					<HugeiconsIcon icon={LicenseIcon} size={18} aria-hidden />
				</div>
				<div className="identifier-body flex min-w-0 flex-1 flex-col gap-0.5">
					<div className="identifier-text truncate text-sm font-medium leading-tight text-black/80 dark:text-white/80">{t("itemIdentifierLicence")}</div>
					{terms ? (
						<a href={terms} target="_blank" rel="noopener noreferrer license" className="identifier-text block truncate text-xs leading-tight text-link transition-colors hover:underline">
							{name}
						</a>
					) : (
						<span className="identifier-text block truncate text-xs leading-tight text-black/60 dark:text-white/60">{name}</span>
					)}
				</div>
			</div>
		</div>
	);
}

function ItemCollection({
	collection,
	item,
	publicationCount,
}: {
	collection: Collection;
	item: Item | undefined;
	/** Published records in the collection or its subcollections, as its link shows. */
	publicationCount: number;
}) {
  const locale = useLocale();
	const tLabels = useTranslations("item");
	const [referrer] = useQueryState("referrer");
	const reducedMotion = useReducedMotion();
	const ancestry = collection.ancestry || [];
	const collectionsData = item?.collectionsData as Collection[];

	const hierarchyNames = ancestry.map((ancestorKey) => {
		const ancestorCollection = collectionsData.find(
			(c) => c.key === ancestorKey,
		);
		return {
			name: ancestorCollection?.name || ancestorKey,
			key: ancestorKey,
		};
	});

	const fullHierarchy = [
		...hierarchyNames,
		{ name: collection.name || collection.key, key: collection.key },
	];

	const filterTo = (depth: number) => ({
		href: getSafeReferrer(referrer),
		params: {
			collections: fullHierarchy.slice(0, depth + 1).map((h) => h.key),
			referrer: referrer ?? undefined,
		},
	});

	return (
		<li key={collection.key}>
			<Tooltip
				color="default"
				delay={HOVER_CARD_DELAY}
				closeDelay={HOVER_CARD_CLOSE_DELAY}
				placement="top-start"
				offset={10}
				disableAnimation={Boolean(reducedMotion)}
				className="w-[360px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-black/10 bg-card_light p-0 text-black shadow-xl dark:border-white/10 dark:bg-card dark:text-white"
				content={
					<div className="flex w-full flex-col">
						<div className="space-y-3 p-4">
							<div className="flex items-start gap-2.5">
								<HugeiconsIcon
									icon={Folder01Icon}
									size={18}
									className="mt-0.5 shrink-0 text-accent"
									aria-hidden
								/>
								<div className="min-w-0">
									<h3 className="text-base font-semibold leading-snug">
										{collection.name}
									</h3>
									{publicationCount > 0 && (
										<p className="mt-0.5 text-xs text-black/50 dark:text-white/50">
											{publicationCount.toLocaleString(locale)}{" "}
											{publicationCount === 1 ? "publication" : "publications"}
										</p>
									)}
								</div>
							</div>
							{hierarchyNames.length > 0 && (
								<HierarchyTree
									label={tLabels("collectionPath")}
									levels={fullHierarchy}
									renderLink={(level, index, className) => (
										<LinkWithParams {...filterTo(index)} className={className}>
											{level.name}
										</LinkWithParams>
									)}
								/>
							)}
						</div>
						<div className="shrink-0 border-t border-black/[0.07] bg-black/[0.025] p-1.5 dark:border-white/[0.07] dark:bg-white/[0.025]">
							<Button
								as={LinkWithParams}
								{...filterTo(fullHierarchy.length - 1)}
								size="sm"
								variant="transparent"
								className="w-full justify-between px-2.5 text-sm font-medium text-inherit"
								endContent={
									<HugeiconsIcon
										icon={ArrowRight01Icon}
										size={16}
										aria-hidden
									/>
								}
							>
								{tLabels("showPublicationsInThisCollection")}
							</Button>
						</div>
					</div>
				}
			>
				<LinkWithParams
					href={getSafeReferrer(referrer)}
					params={{
						collections: [...ancestry, collection.key],
						referrer: referrer ?? undefined,
					}}
				>
					<motion.div
						whileHover={{ scale: 1.02 }}
						whileTap={{ scale: 0.98 }}
						transition={{
							type: "spring",
							stiffness: 400,
							damping: 10,
						}}
					>
						<Card className="py-1 px-3" color="card">
							{collection.name}
						</Card>
					</motion.div>
				</LinkWithParams>
			</Tooltip>
		</li>
	);
}

export function ItemCollections({ item }: { item: Item | undefined }) {
	const tLabels = useTranslations("item");
	const isCollectionsEnabled = useLibraryFeature("collections");
	const t = useTranslations("ui");
	// The library-wide counts the sidebar shows: a collection's own records
	// plus its subcollections'. Zotero's own count leaves out subcollections,
	// so a parent folder would read as empty.
	const { data: facets } = useSWR<FacetsGetResponse>(
		isCollectionsEnabled ? "/facets" : null,
		fetcher,
		{ revalidateOnFocus: false },
	);

	if (!isCollectionsEnabled) return null;

	const visibleCollections = (
		(item?.collectionsData as Collection[]) || []
	).filter((collection) => collection.originalFacet);

	const groupedCollections = visibleCollections.reduce(
		(acc, collection) => {
			const title = collection.title || tLabels("unknownCollection");
			if (!acc[title]) {
				acc[title] = [];
			}
			acc[title].push(collection);
			return acc;
		},
		{} as Record<string, Collection[]>,
	);

	if (!Object.keys(groupedCollections).length) return null;

	return (
		<ItemPropertyRowWrapper title={t("itemTopicsCollectionsTitle")}>
			<div className="flex flex-col gap-4">
				{Object.entries(groupedCollections).map(
					([title, collections]) => (
						<div key={title}>
							<h4 className="text-base font-medium text-black/60 dark:text-white/60 mb-2">
								{title}
							</h4>
							<ul className="text-base text-black/60 dark:text-white/60 flex flex-wrap gap-2">
								{collections.map((collection) => (
									<ItemCollection
										key={collection.key}
										collection={collection}
										item={item}
										publicationCount={
											facets?.facetDistribution.collectionsAncestry?.[
												collection.key
											] ?? 0
										}
									/>
								))}
							</ul>
						</div>
					),
				)}
			</div>
		</ItemPropertyRowWrapper>
	);
}

function ItemCountry({ item }: { item: Item | undefined }) {
	const t = useTranslations("ui");
	const countries = Array.isArray(item?.country) ? item.country : [];

	if (!countries.length) return null;

	return (
		<ItemPropertyRowWrapper title={t("itemCountryFocusTitle")}>
			<p className="text-black/60 dark:text-white/60">
				{t("itemCountryFocusDescription")}
			</p>
			<CountryDisplay countries={countries} />
		</ItemPropertyRowWrapper>
	);
}

function ItemAttachments({ item }: { item: Item | undefined }) {
	const t = useTranslations("ui");
	const validAttachments = item?.attachmentsData?.filter(
		isVisiblePdfAttachment,
	);

	// A PDF kept from readers for now is named where the file would be, with the day it opens, beside any they can open.
	const held = item?.heldPdf;
	if (!validAttachments?.length && !held) return null;

	return (
		<ItemPropertyRowWrapper title={t("itemAttachmentsTitle")}>
			{validAttachments?.length ? (
				<p className="text-black/60 dark:text-white/60">
					{t("itemAttachmentsDescription")}
				</p>
			) : null}
			<div className="flex flex-col gap-4">
				{validAttachments?.map((attachment) => (
					<Attachment
						key={attachment.key}
						data={attachment}
						item={item!}
					/>
				))}
				{held ? <HeldPdf until={held.until} /> : null}
			</div>
		</ItemPropertyRowWrapper>
	);
}

function ItemVectorRelations({ item }: { item: Item | undefined }) {
	const { loading } = use(LoadingContext);
	const t = useTranslations("ui");

	return (
		<ItemPropertyRowWrapper
			className="[&:not(:has(#vector-relations))]:hidden"
			title={t("recommendedResources")}
		>
			<p className="text-black/60 dark:text-white/60">
				{t("recommendedResourcesDescription")}
			</p>
			<VectorRelations item={item} loading={loading} />
		</ItemPropertyRowWrapper>
	);
}

/** The tab a card's count asks for in the address, and the list each tab shows. */
const ASKED_TAB: Record<string, string> = { references: "cites", citations: "citedBy" };
const TAB_LIST: Record<string, OpenScholarList> = { cites: "references", citedBy: "citations" };

/**
 * What OpenAlex lists in all for a record's references or citations, beside what the library holds, opening the whole
 * list in OpenScholar. Nothing for a record that is not an OpenAlex work, or a list OpenAlex has none of.
 */
function OpenScholarTotal({ item, tab }: { item: Item | undefined; tab: string }) {
	const t = useTranslations("ui");
	const locale = useLocale();
	const openScholar = useOpenScholarUrl();
	const list = openScholarList(item, TAB_LIST[tab]);
	if (!list?.total) return null;
	return (
		<a href={openScholar(list.path)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
			{t("onOpenAlex", { count: list.total.toLocaleString(locale) })}
			<HugeiconsIcon icon={ArrowUpRight01Icon} aria-hidden size={14} />
		</a>
	);
}

/** For a meta-analysis whose analysed studies are known: how its references split, as Björn counts them (the evidence map). */
function AnalysedStudies({ itemKey }: { itemKey: string | undefined }) {
	const tLabels = useTranslations("item");
	const evidence = useEvidenceRecord(itemKey);
	if (!evidence?.analysed) return null;
	const others = (evidence.reviews ?? 0) + (evidence.other ?? 0);
	return (
		<p className="text-black/80 dark:text-white/80">
			{tLabels("ofTheWorksItCitesAre", { analysed: evidence.analysed ?? 0, analysedHere: evidence.analysedHere ?? 0, others })}{" "}
			<Link href={`/evidence?paper=${itemKey}`} className="font-medium text-accent hover:underline">{tLabels("seeTheStudiesItAnalysed")}</Link>
		</p>
	);
}

const hasLibraryLinks = (links: Item["links"] | undefined) =>
	Boolean(links && (links.cites.length > 0 || links.citedBy.length > 0 || links.related.length > 0));

function ItemRelations({ item }: { item: Item | undefined }) {
	const t = useTranslations("ui");
	// A card's reference count opens this page on its References list, and its citation count on Citations.
	const asked = useSearchParams().get("links");
	// The tab the address asks for, until the reader picks another. A new address asks again, without an effect.
	const [picked, setPicked] = useState<{ asked: string | null; tab: string } | null>(null);
	const selectedTab = picked?.asked === asked ? picked.tab : ASKED_TAB[asked ?? ""] ?? "general";
	const setSelectedTab = (tab: string) => setPicked({ asked, tab });

	const descriptions: Record<string, string> = {
		general: t("relatedResourcesByCitation"),
		cites: t("citesResource"),
		citedBy: t("citedByResource"),
	};
	// The tabs hide empty lists, so describe the tab that is really shown.
	const { activeTab } = planRelationTabs({
		activeTab: selectedTab,
		links: item?.links,
		relations: item?.relations as RelationsType,
	});
	// OpenAlex records show provider relations elsewhere; only in-library links belong here.
	// The studies a meta-analysis pooled come from the evidence map, not its links, so they show without them.
	if (isOpenAlexWorkProvider(item?.provider) && !hasLibraryLinks(item?.links)) return <AnalysedStudies itemKey={item?.key} />;

	return (
		<div className="flex flex-col gap-4">
			<div className="w-full">
				<Relations
					links={item?.links}
					relations={item?.relations as RelationsType}
					selectedTab={selectedTab}
					onTabChange={setSelectedTab}
					showTabsOnly={true}
				/>
			</div>
			<p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-black/60 dark:text-white/60">
				{descriptions[activeTab] || descriptions.general}
				<OpenScholarTotal item={item} tab={activeTab} />
			</p>
			<AnalysedStudies itemKey={item?.key} />
			<Relations
				links={item?.links}
				relations={item?.relations as RelationsType}
				selectedTab={selectedTab}
				onTabChange={setSelectedTab}
				showContentOnly={true}
			/>
		</div>
	);
}

function useNotesDescription() {
	const t = useTranslations("ui");
	return t("itemNotesDescription");
}

function ItemNotes({ item }: { item: Item | undefined }) {
	const tLabels = useTranslations("item");
	const { sourcePublishTags } = useLibraryConfig();
	const publishTags = recordPublishTags(sourcePublishTags, item?.sourceConnectionKey);
	const notes = item?.attachmentsData?.filter((attachment) =>
		isPublishedNote(attachment, publishTags),
	);
	const links = item?.attachmentsData?.filter(
		(attachment) =>
			isPublishedLink(attachment, publishTags) &&
			!isVisiblePdfAttachment(attachment),
	);

	const notesDescription = useNotesDescription();

	if (!notes?.length && !links?.length) return null;

	return (
		<ItemPropertyRowWrapper title={tLabels("notes")}>
			{notesDescription && (
				<p className="text-black/60 dark:text-white/60">
					{notesDescription}
				</p>
			)}
			<div className="flex flex-col gap-4">
				{notes?.map((note) => (
					<Card key={note.key} color="card" className="flex flex-col">
						<div
							className="[&_a]:text-link"
							dangerouslySetInnerHTML={{
								__html:
									note.note?.replaceAll(
										"background-color: rgb(255, 255, 255)",
										"",
									) ?? "",
							}}
						/>
					</Card>
				))}
				{links?.map((link) => (
					<a
						key={link.key}
						href={link.url || ""}
						target="_blank"
						rel="noopener noreferrer"
						className="no-underline group"
					>
						<Card
							color="card"
							className="flex flex-col p-4 transition-colors hover:bg-accent/5 group-hover:border-accent/50"
						>
							<div className="flex items-center gap-2 text-link font-medium">
								{link.title || link.url}
							</div>
							{link.title && link.url && (
								<div className="text-sm text-black/60 dark:text-white/60 break-all mt-1">
									{link.url}
								</div>
							)}
						</Card>
					</a>
				))}
			</div>
		</ItemPropertyRowWrapper>
	);
}

export default function ItemPage({
	data,
	loading: loadingProp,
}: {
	data: ItemGetResponse;
	loading: boolean;
}) {
	const tLabels = useTranslations("item");
	const { topics } = useLibraryConfig();
	const loading = data?.item ? false : loadingProp;

	useEffect(() => {
		// Zotero Connector listens for this browser event to refresh its page snapshot.
		document.dispatchEvent(
			new Event("ZoteroItemUpdated", { bubbles: true, cancelable: true }),
		);
	}, [data?.item]);

	const item = (loading ? undefined : data?.item)!;

	return (
		<PageContainer>
			{item && <abbr className="unapi-id" title={item.key}></abbr>}
			<LoadingContext.Provider value={{ loading }}>
				<div className="flex flex-col gap-8">
					<div className="flex flex-col gap-4">
						<ItemHeader item={item} isLoading={loading} />
						<ItemTitle item={item} />
						{hasTag(item?.tags, "Retracted") ? (
							<div
								role="alert"
								className="flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-danger"
							>
								<HugeiconsIcon
									icon={Alert02Icon}
									className="mt-0.5 size-5 shrink-0"
								/>
								<div>
									<p className="font-semibold">
										{tLabels("retractedPublication")}
									</p>
									<p className="text-sm text-danger/80">
										{tLabels("thisPublicationHasBeenMarkedAs")}
									</p>
								</div>
							</div>
						) : null}
					</div>
					<div className="flex flex-col lg:grid grid-cols-12 gap-8">
						<div className="col-span-8 xl:col-span-9 ">
							<AnimatePresence>
								{loading ? (
									<motion.div className="flex justify-center items-center min-h-screen">
										<Spinner />
									</motion.div>
								) : (
									<motion.div
										initial={
											loadingProp
												? { opacity: 0, y: 32 }
												: { opacity: 1, y: 0 }
										}
										animate={{ opacity: 1, y: 0 }}
										exit={{ opacity: 0, y: -10 }}
										transition={{
											duration: 0.3,
											type: "spring",
										}}
										className="flex flex-col gap-12"
									>
										{item?.abstractNote &&
											item?.abstractNote.length > 0 && (
												<>
													<ItemAbstract item={item} />
													<Divider />
												</>
											)}
										<ItemCitation item={item} />
										{topics.enabled &&
										item?.topics?.length ? (
											<ItemTopics
												topicIds={item.topics}
												topics={data.topics}
											/>
										) : null}
										<ItemAttachments item={item} />
										<ItemNotes item={item} />
										<ItemCollections item={item} />
										<ItemCountry item={item} />
										<ItemVectorRelations item={item} />
										<ItemRelations item={item} />
									</motion.div>
								)}
							</AnimatePresence>
						</div>
						<div className="col-span-4 xl:col-span-3">
							<div className="flex flex-col gap-8">
								<ItemAuthors item={item} />
								<ItemInstitutions item={item} />
								<ItemFundingPartners />
								<ItemIdentifiers item={item} />
								<ItemDetails item={item} />
								<ItemTechnical item={item} />
							</div>
						</div>
					</div>
				</div>
			</LoadingContext.Provider>
		</PageContainer>
	);
}
