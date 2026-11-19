"use client";

import { Item, ItemGetResponse, Author } from "@/app/api/item/types";
import PageContainer from "@/components/layout/PageContainer";
import { Card } from "@/components/nextui/Card";
import { FaCalendar } from "react-icons/fa";
import { RelationsType } from "@/types/item";
import {
	IoBook,
	IoDocumentText,
	IoDownloadOutline,
	IoChevronBack,
	IoDownload,
} from "react-icons/io5";
import { SiZenodo } from "react-icons/si";
import { BsQuote } from "react-icons/bs";
import { Avatar } from "@nextui-org/avatar";
import { HiAcademicCap } from "react-icons/hi2";
import { useFormatter, useTranslations } from "next-intl";
import { Divider, Spinner } from "@nextui-org/react";
import { Skeleton } from "@/components/nextui/Skeleton";
import CopyButton from "@/components/features/newlib/CopyButton";
import { Button } from "@/components/nextui/Button";
import { Collection } from "@/app/api/collections/types";
import { twMerge } from "tailwind-merge";
import { CountryDisplay } from "@/components/features/newlib/CountryDisplay";
import Attachment from "@/components/features/items/Attachment";
import VectorRelations from "@/components/features/newlib/VectorRelations";
import { fetcher, getExtraValues } from "@/lib/utils";
import Relations from "@/components/features/newlib/Relations";
import { DownloadButton } from "@/components/features/newlib/DownloadModal";
import AiWrapper from "@/components/features/newlib/AiWrapper";
import ZoteroDropdown from "@/components/features/newlib/ZoteroDropdown";
import LinkWithParams from "../LinkWithParams";
import { Link } from "@/i18n/routing";
import { serializeSearchParams } from "@/lib/searchParams";
import { Tooltip } from "@nextui-org/react";
import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import LikeButton from "../items/LikeButton";
import { AddButton } from "../items/Resource";
import { BiDownload } from "react-icons/bi";
import { LuDownload } from "react-icons/lu";
import {
	createContext,
	use,
	useCallback,
	useEffect,
	useState,
	useMemo,
} from "react";
import { useFeatureFlagEnabled } from "@/context/Providers";
import { useQueryState } from "nuqs";
import ItemOld from "@/components/pages/Item";
import ItemHeader from "@/components/features/newlib/ItemHeader";
import ItemTitle from "@/components/features/newlib/ItemTitle";
import {
	COUNTRIES,
	FUNDING_PARTNER,
	INSTITUTIONS_NAME,
	NOTES_DESCRIPTION,
	SHOW_URL_IN_CITATION,
	getSafeReferrer,
} from "@/constants/misc";
import { transformItem } from "@/lib/utils";
import { INTERNAL_TAG, PUBLISH_TAGS } from "@/constants/items";
import { hasAnyTag } from "@/lib/tags";
import useSWR from "swr";
import ZoteroRichText from "@/components/features/items/ZoteroRichText";
import CitationDoiLink from "@/components/features/items/CitationDoiLink";
import { resolveCitationDisplayMode } from "@/lib/citationMode.mts";
import { zoteroMarkupToPlainText } from "@/lib/zoteroMarkup";
import { isVisiblePdfAttachment } from "@/lib/attachment-visibility";
import { ResultsTranslationProvider, useItemTranslation } from "@/components/features/translation/ResultsTranslation";
import {
	buildDoiDisplayLinks,
	type DoiDisplayAttachment,
	type DoiDisplayLink,
	type DoiDisplayProvider,
} from "@opendeved/doi-sync-core/display";

export const LoadingContext = createContext<{ loading: boolean }>({
	loading: false,
});

const decodeHTMLEntities = (text: string) => {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
		.replace(/&#x([0-9A-F]+);/gi, (_, hex) =>
			String.fromCharCode(parseInt(hex, 16)),
		)
		.replace(/<[^>]*>?/g, "");
};

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
				<div className="flex items-center gap-3">
					{icon}
					<div className="flex min-w-0 flex-col">
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

function ItemAuthor({ author }: { author?: Author }) {
	const [referrer, setReferrer] = useQueryState("referrer");
	const t = useTranslations("creatorType");
	const tUI = useTranslations("ui");
	const creatorTypeLabel = author ? t(author?.creatorType) : undefined;
	const { creatorType, institutions, ...rest } = author || {};
	const fullName = author
		? author?.name
			? author.name
			: `${author?.firstName} ${author?.lastName}`
		: undefined;

	const isAuthorFilterEnabled = useFeatureFlagEnabled("author-filter");
	const affiliationCount = author?.institutions?.length || 0;

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

	return (
		<Tooltip
			isDisabled={affiliationCount === 0}
			key={author?.name}
			className="rounded-2xl bg-white dark:bg-card"
			placement="left"
			content={
				<div className="py-2 px-1 min-w-[300px]">
					{/* Author Header */}
					<motion.div
						className="flex items-center gap-3 mb-4"
						initial={{ opacity: 0, y: -10 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ duration: 0.2 }}
					>
						<Avatar
							name={author ? formatAuthor(author).charAt(0) : "-"}
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
								{author?.firstName} {author?.lastName}
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

					{/* Institutions List */}
					{author?.institutions &&
						author?.institutions?.length > 0 && (
							<motion.div
								className="w-full flex flex-col gap-2"
								initial={{ opacity: 0, y: 10 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ delay: 0.3 }}
							>
								<h4 className="text-sm font-medium text-black/70 dark:text-white/70">
									Affiliations
								</h4>
								{author.institutions.map((institution, idx) => (
									<LinkWithParams
										key={idx}
										href={
											isAuthorFilterEnabled
												? getSafeReferrer(referrer)
												: undefined
										}
										params={{
											institution: [
												institution.display_name || "",
											],
											referrer: referrer ?? undefined,
										}}
										className="w-full"
									>
										<motion.div
											key={idx}
											className="w-full flex items-center gap-2 p-2 rounded-xl bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
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
														initial={{
															opacity: 0,
														}}
														animate={{
															opacity: 1,
														}}
														transition={{
															delay:
																0.5 + idx * 0.1,
														}}
													>
														<div className="w-4 h-3 rounded-sm overflow-hidden shadow-sm">
															<img
																src={`https://flagcdn.com/${institution.country_code.toLowerCase()}.svg`}
																alt={
																	institution.country_code
																}
																className="w-full h-full object-cover"
															/>
														</div>
														<span className="text-xs text-black/60 dark:text-white/60">
															{`${
																COUNTRIES[
																	institution
																		.country_code
																]
															} (${
																institution.country_code
															})`}
														</span>
													</motion.div>
												)}
											</div>
										</motion.div>
									</LinkWithParams>
								))}
							</motion.div>
						)}
				</div>
			}
		>
			<LinkWithParams
				href={
					isAuthorFilterEnabled
						? getSafeReferrer(referrer)
						: undefined
				}
				params={
					fullName && isAuthorFilterEnabled
						? { author: fullName, referrer: referrer ?? undefined }
						: {}
				}
				className="opacity-100"
			>
				<ItemRow
					icon={
						<Avatar
							name={author ? formatAuthor(author).charAt(0) : "-"}
							size="sm"
							className="text-lg text-accent bg-accent/10 brightness-150 shrink-0"
						/>
					}
					title={author && formatAuthor(author)}
					subtitle={subtitle}
				/>
			</LinkWithParams>
		</Tooltip>
	);
}

function ItemAuthors({ item }: { item: Item | undefined }) {
	const { loading } = use(LoadingContext);
	const t = useTranslations("ui");
	const authors = item?.creators as Author[];
	if (!authors?.length && !loading) return null;

	return (
		<SidebarCard title={t("itemAuthorsTitle")} count={authors?.length}>
			{loading
				? Array.from({ length: 3 }).map((_, index) => (
						<ItemAuthor key={index} author={undefined} />
					))
				: authors?.map((author: Author, index: number) => (
						<ItemAuthor key={index} author={author} />
					))}
		</SidebarCard>
	);
}

function ItemInstitution({ institution }: { institution?: string }) {
	const [referrer, setReferrer] = useQueryState("referrer");
	const isAuthorLocationEnabled = useFeatureFlagEnabled("author-location");

	return (
		<LinkWithParams
			href={
				isAuthorLocationEnabled ? getSafeReferrer(referrer) : undefined
			}
			params={
				institution && isAuthorLocationEnabled
					? {
							institution: [institution],
							referrer: referrer ?? undefined,
						}
					: {}
			}
			className="opacity-100"
		>
			<ItemRow
				key={institution}
				icon={
					<div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg text-accent bg-accent/10 brightness-150 shrink-0">
						<HiAcademicCap />
					</div>
				}
				title={institution}
			/>
		</LinkWithParams>
	);
}

function ItemInstitutions({ item }: { item: Item | undefined }) {
	const { loading } = use(LoadingContext);
	const t = useTranslations("ui");
	const institutions = (item?.institution as string[]) || [];
	if (!institutions?.length && !loading) return null;

	return (
		<SidebarCard
			title={t(INSTITUTIONS_NAME || "itemInstitutionsTitle")}
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

function ItemResearchPartner({ item }: { item: Item | undefined }) {
	const { loading } = use(LoadingContext);
	const t = useTranslations("ui");

	return (
		<SidebarCard title={t("fundingPartner")} count={1}>
			{loading ? (
				<ItemInstitution key={0} institution={undefined} />
			) : (
				<ItemInstitution key={0} institution={FUNDING_PARTNER} />
			)}
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

function formatValue(
	key: keyof Item,
	value: any,
	formatter: ReturnType<typeof useFormatter>,
) {
	if (
		key.toLowerCase().includes("date") ||
		["createdAt", "updatedAt"].includes(key)
	) {
		return formatDate(value, formatter);
	}

	return value;
}

function ItemDetailsRow({
	detail,
}: {
	detail?: { label: string; value: any };
}) {
	const { loading } = use(LoadingContext);
	const t = useTranslations("article");
	const tUI = useTranslations("ui");
	const formatter = useFormatter();
	const formattedValue = detail
		? formatValue(detail.label as keyof Item, detail.value, formatter)
		: undefined;

	return (
		<div className="px-4">
			<Skeleton className="rounded-2xl w-full" isLoaded={!loading}>
				<div className="flex justify-between gap-2">
					<div className="text-base font-medium flex-1">
						<div className="text-sm text-black/60 dark:text-white/60">
							{detail?.label ? t(detail?.label) : "-"}
						</div>
						<div className="flex justify-between">
							<div className="text-base">
								{formattedValue ? (
									<span
										dangerouslySetInnerHTML={{
											__html: ProcessHTML(
												String(formattedValue) || "",
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
						ariaLabel={tUI("itemCopyCitationAriaLabel")}
					/>
				</div>
			</Skeleton>
		</div>
	);
}

function ItemDetails({ item }: { item: Item | undefined }) {
	const { loading } = use(LoadingContext);
	const t = useTranslations("ui");
	const excludedFields: (keyof Item)[] = [
		"title",
		"creators",
		"institution",
		"abstractNote",
		"citation",
		"collectionsData",
		"key",
		"fullNames",
		"id",
		"itemType",
		"version",
		"country",
		"institution",
		"dateAdded",
		"dateModified",
		"deleted",
		"groupExternalId",
		"collections",
		"relations",
		"createdAt",
		"updatedAt",
		"collectionsAncestry",
		"date",
		"year",
		"apc_list",
		"apc_paid",
		"attachmentsData",
		"fullTextPDFs",
		"tags",
		"extra",
		"callNumber",
		"dateTimestamp",
		"DOI",
	];

	if (!item && !loading) return null;

	const isCurrentEvidenceLibraryUrl = item
		? buildCanonicalWebsiteLink(item) !== null
		: false;
	const details = Object.entries(item || {})
		.filter(([key, value]) => value !== null)
		.filter(
			([key]) => key !== "url" || !isCurrentEvidenceLibraryUrl,
		)
		.map(([key, value]) => ({
			label: key,
			value: String(value),
		}));

	return (
		<SidebarCard title={t("itemPublicationDetailsTitle")}>
			{loading
				? Array.from({ length: 3 }).map((_, index) => (
						<ItemDetailsRow key={index} detail={undefined} />
					))
				: details
						.filter(
							(detail) =>
								!excludedFields.includes(
									detail.label as keyof Item,
								),
						)
						.map((detail) => (
							<ItemDetailsRow
								key={detail.label}
								detail={detail}
							/>
						))}
		</SidebarCard>
	);
}

function ItemTechnical({ item }: { item: Item | undefined }) {
	const { loading } = use(LoadingContext);
	const t = useTranslations("ui");
	if ((!item || item.groupExternalId !== 1) && !loading) return null;
	const relations = item?.relations as RelationsType;

	const keyValues = {
		citedBy: relations?.cited_by || 0,
		cites: relations?.referenced_works?.length || 0,
	};

	return (
		<SidebarCard title={t("itemTechnicalDetailsTitle")} color="card">
			{loading
				? Array.from({ length: 3 }).map((_, index) => (
						<ItemDetailsRow key={index} detail={undefined} />
					))
				: Object.entries(keyValues).map(([key, value]) => (
						<ItemDetailsRow
							key={key}
							detail={{
								label: key,
								value: value,
							}}
						/>
					))}
		</SidebarCard>
	);
}

function ItemPropertyRowWrapper({
	children,
	title,
	copyText,
	className,
}: {
	children: React.ReactNode;
	title: string;
	copyText?: string;
	className?: string;
}) {
	const tUI = useTranslations("ui");
	return (
		<div className={twMerge("flex flex-col gap-4", className)}>
			<div className="flex items-center justify-between">
				<h3 className="text-xl font-medium">{title}</h3>
				{copyText && (
					<CopyButton
						textToCopy={copyText}
						ariaLabel={tUI("itemCopyCitationAriaLabel")}
					/>
				)}
			</div>
			{children}
		</div>
	);
}

function ItemAbstract({ item }: { item: Item | undefined }) {
	const t = useTranslations("ui");
	const translation = useItemTranslation(item?.key);
	const translated = translation && !translation.showingOriginal ? translation : null;
	const abstract = item?.abstractNote || "";
	return (
		<ItemPropertyRowWrapper
			title={t("itemAbstractTitle")}
			copyText={zoteroMarkupToPlainText(abstract) || undefined}
		>
			{translated?.abstract ? (
				<p className="text-base text-black/60 dark:text-white/60 whitespace-pre-line">{translated.abstract}</p>
			) : (
				<ZoteroRichText
					markup={abstract}
					className={twMerge(
						"text-base text-black/60 dark:text-white/60 transition-opacity",
						(translation?.pending || translated?.abstractPending) && "opacity-40 animate-pulse",
					)}
				/>
			)}
		</ItemPropertyRowWrapper>
	);
}

function ProcessHTML(html: string) {
	// Single pass: match URLs or bare DOIs
	const combined = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)|(10\.\d{4,9}\/[-._;():\w]+)/gi;
	const linkClass = "text-link_light dark:text-link hover:underline";

	return html.replace(combined, (match, url, doi) => {
		const href = url || `https://doi.org/${doi}`;
		return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="${linkClass}">${match}</a>`;
	});
}

function ItemCitation({ item }: { item: Item | undefined }) {
	const t = useTranslations("ui");
	const [origin, setOrigin] = useState("");
	const citationDisplayMode = useMemo(
		() => resolveCitationDisplayMode(item),
		[item],
	);
	const { data: citationResponse, isLoading: isCitationFetching } = useSWR<{
		citation: string | null;
	}>(
		citationDisplayMode.mode === "citation" && item?.key
			? `/item/${item.key}/citation`
			: null,
		fetcher,
		{
			revalidateOnFocus: false,
			revalidateOnReconnect: false,
			revalidateIfStale: false,
		}
	);
	const resolvedCitation = citationResponse?.citation || item?.citation || "";

	useEffect(() => {
		if (typeof window !== "undefined") {
			setOrigin(window.location.origin);
		}
	}, []);

	const { citationCopy, citationHtml, isLoading } = useMemo(() => {
		if (citationDisplayMode.mode === "doi-only") {
			return {
				citationCopy: citationDisplayMode.link?.url,
				citationHtml: undefined,
				isLoading: false,
			};
		}

		if (isCitationFetching || resolvedCitation === "<div>Loading...</div>") {
			return { isLoading: true };
		}

		const rawCitation = resolvedCitation;
		const cleanCitationText = rawCitation.replace(/<[^>]+>/g, "");
		const decodedCitation = cleanCitationText
			? decodeHTMLEntities(cleanCitationText)
			: undefined;

		if (!SHOW_URL_IN_CITATION || !item?.key || !decodedCitation) {
			return {
				citationCopy: decodedCitation,
				citationHtml: ProcessHTML(rawCitation.trim()),
				isLoading: false,
			};
		}

		const urlStr = origin
			? `${origin}/lib/${item.key}`
			: `/lib/${item.key}`;
		const linkHtml = `<a href="${urlStr}" target="_blank" rel="noopener noreferrer" class="text-link_light dark:text-link hover:underline">${urlStr}</a>`;

		// Copy Text Logic
		let copy = decodedCitation;
		if (!copy.endsWith(".")) copy += ".";
		copy += ` Available at ${urlStr}.`;

		// Display HTML Logic
		const html = rawCitation.trim();
		const divRegex = /<\/div>\s*$/;
		const hasDiv = divRegex.test(html);
		const baseHtml = html.replace(divRegex, "");

		const processedBase = ProcessHTML(baseHtml);

		const separator = cleanCitationText.trim().endsWith(".") ? "" : ".";
		let finalHtml = `${processedBase}${separator} Available at ${linkHtml}.`;

		if (hasDiv) {
			finalHtml = `${finalHtml}</div>`;
		}

		return {
			citationCopy: copy,
			citationHtml: finalHtml,
			isLoading: false,
		};
	}, [citationDisplayMode, isCitationFetching, item?.key, origin, resolvedCitation, t]);

	if (citationDisplayMode.mode === "doi-only") {
		if (!citationDisplayMode.link) return null;

		return (
			<ItemPropertyRowWrapper
				title={t("itemCitationTitle")}
				copyText={citationDisplayMode.link.url}
			>
				<CitationDoiLink
					link={citationDisplayMode.link}
					className="text-base text-wrap-anywhere"
				/>
			</ItemPropertyRowWrapper>
		);
	}

	return (
		<ItemPropertyRowWrapper
			title={t("itemCitationTitle")}
			copyText={citationCopy}
		>
			<AnimatePresence>
				{isLoading ? (
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.3 }}
					>
						<Skeleton
							isLoaded={false}
							className="rounded-2xl w-full min-h-16"
						/>
					</motion.div>
				) : (
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.3 }}
					>
						<p
							dangerouslySetInnerHTML={{
								__html: citationHtml || "",
							}}
							className="text-base text-black/60 dark:text-white/60 text-wrap-anywhere"
						/>
					</motion.div>
				)}
			</AnimatePresence>
		</ItemPropertyRowWrapper>
	);
}

function toDoiDisplayAttachment(attachment: Item): DoiDisplayAttachment {
	return {
		linkMode: attachment.linkMode,
		title: attachment.title,
		url: attachment.url,
		tags: attachment.tags,
	};
}

function CrossrefLogo({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 65.4 95.2"
			role="img"
			aria-label="Crossref"
			className={className}
		>
			<g transform="translate(-111.8 -0.3)">
				<polygon
					fill="#3EB1C8"
					points="111.8,95.5 111.8,66.8 135.4,59 177.2,73.3"
				/>
				<polygon
					fill="#D8D2C4"
					points="153.6,36.8 111.8,51.2 135.4,59 177.2,44.6"
				/>
				<polygon
					fill="#4F5858"
					points="135.4,59 177.2,44.6 177.2,73.3"
				/>
				<polygon
					fill="#FFC72C"
					points="177.2,0.3 177.2,29 153.6,36.8 111.8,22.5"
				/>
				<polygon
					fill="#EF3340"
					points="153.6,36.8 111.8,51.2 111.8,22.5"
				/>
			</g>
		</svg>
	);
}

type CanonicalWebsiteLink = {
	provider: "website";
	kind: "canonical";
	label: string;
	value: string;
	url: string;
	iconUrl: string;
};

type IdentifierDisplayLink = DoiDisplayLink | CanonicalWebsiteLink;

function parseUrl(value: string | null | undefined) {
	if (!value) return null;

	try {
		return new URL(value);
	} catch {
		return null;
	}
}

function normaliseCanonicalPath(pathname: string) {
	const parts = pathname.split("/").filter(Boolean);
	const libIndex = parts.indexOf("lib");
	if (libIndex === -1) return null;

	const key = parts[libIndex + 1];
	if (!key) return null;
	return `/lib/${key}`;
}

function normaliseCanonicalHost(host: string) {
	return host.toLowerCase().replace(/^www\./, "");
}

function buildCanonicalWebsiteLink(item: Item): CanonicalWebsiteLink | null {
	const itemUrl = parseUrl(item.url);
	const canonicalBaseUrl = parseUrl(process.env.NEXT_PUBLIC_CANONICAL_BASE_URL);
	if (!itemUrl || !canonicalBaseUrl) return null;
	if (
		normaliseCanonicalHost(itemUrl.host) !==
		normaliseCanonicalHost(canonicalBaseUrl.host)
	) {
		return null;
	}
	if (normaliseCanonicalPath(itemUrl.pathname) !== `/lib/${item.key}`) return null;

	return {
		provider: "website",
		kind: "canonical",
		label: "itemIdentifierEvidenceLibrary",
		value: `${itemUrl.host}${itemUrl.pathname}`,
		url: itemUrl.toString(),
		iconUrl: new URL("/favicon.ico", canonicalBaseUrl).toString(),
	};
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
				<CrossrefLogo className="h-6 w-4" />
			) : (
				<SiZenodo
					className="size-5 text-[#1682D4]"
					aria-label="Zenodo"
				/>
			)}
		</div>
	);
}

function getIdentifierDisplayTitle(
	link: IdentifierDisplayLink,
	t: ReturnType<typeof useTranslations>,
) {
	if (link.provider === "website") return t("itemIdentifierEvidenceLibrary");
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
		<div className="px-4">
			<div className="flex items-center gap-3">
				<IdentifierLogo link={link} />
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<div className="truncate text-sm font-medium leading-tight text-black/80 dark:text-white/80">
						{getIdentifierDisplayTitle(link, t)}
					</div>
					<div className="relative min-w-0 overflow-hidden">
						<a
							href={link.url}
							target="_blank"
							rel="noopener noreferrer"
							className="block overflow-hidden whitespace-nowrap pr-5 text-xs leading-tight text-link_light transition-colors hover:underline dark:text-link"
						>
							{link.value}
						</a>
						<div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white via-white/80 to-transparent dark:from-card dark:via-card/80" />
					</div>
				</div>
				<div className="flex shrink-0 items-center">
					<Tooltip content={t("copy")} placement="top">
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
	const links = useMemo(() => {
		if (!item) return [];

		const doiLinks = buildDoiDisplayLinks({
			DOI: item.DOI,
			extra: item.extra,
			attachmentsData: item.attachmentsData?.map(toDoiDisplayAttachment),
		}).links;

		const canonicalLink = buildCanonicalWebsiteLink(item);
		return canonicalLink ? [...doiLinks, canonicalLink] : doiLinks;
	}, [item]);

	if (!links.length) return null;

	return (
		<SidebarCard title={t("itemIdentifiersTitle")} count={links.length}>
			{links.map((link) => (
				<ItemIdentifierRow
					key={`${link.provider}-${link.kind}-${link.value}`}
					link={link}
				/>
			))}
		</SidebarCard>
	);
}

function ItemCollection({
	collection,
	item,
}: {
	collection: Collection;
	item: Item | undefined;
}) {
	const [referrer, setReferrer] = useQueryState("referrer");
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
		{ name: collection.name, key: collection.key },
	];

	return (
		<li key={collection.key}>
			<Tooltip
				content={
					<motion.div
						className="px-2 py-1 min-w-[200px]"
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						transition={{
							type: "spring",
							stiffness: 300,
							damping: 30,
						}}
					>
						{fullHierarchy.map((item, index) => (
							<motion.div
								key={index}
								className="flex items-center gap-2 py-0.5"
								style={{
									paddingLeft: `${index * 12}px`,
								}}
								initial={{ opacity: 0, x: -20 }}
								animate={{ opacity: 1, x: 0 }}
								transition={{
									duration: 0.3,
									delay: index * 0.1,
									ease: [0.23, 1, 0.32, 1],
								}}
							>
								{index > 0 && (
									<motion.div
										className="text-white/40"
										initial={{ opacity: 0, scaleX: 0 }}
										animate={{ opacity: 1, scaleX: 1 }}
										transition={{
											duration: 0.3,
											delay: index * 0.1 + 0.1,
											ease: "anticipate",
										}}
									>
										└─
									</motion.div>
								)}
								<LinkWithParams
									href={getSafeReferrer(referrer)}
									params={{
										collections: fullHierarchy
											.slice(0, index + 1)
											.map((h) => h.key),
										referrer: referrer ?? undefined,
									}}
								>
									<motion.span
										className="text-sm whitespace-nowrap overflow-hidden text-ellipsis relative group"
										whileHover={{ scale: 1.02 }}
										transition={{
											type: "spring",
											stiffness: 400,
											damping: 10,
										}}
									>
										<motion.span className="relative z-10">
											{item.name}
										</motion.span>
										<motion.div
											className="absolute inset-0 bg-accent/20 rounded-sm -z-0"
											initial={{ scaleX: 0 }}
											whileHover={{
												scaleX: 1,
												transition: {
													duration: 0.2,
													ease: "circOut",
												},
											}}
											style={{ originX: 0 }}
										/>
									</motion.span>
								</LinkWithParams>
							</motion.div>
						))}
					</motion.div>
				}
				placement="top"
				classNames={{
					base: [
						"before:bg-secondary-100",
						"data-[showing=true]:animate-in",
						"data-[showing=true]:fade-in-0",
						"data-[showing=true]:zoom-in-95",
						"data-[showing=false]:animate-out",
						"data-[showing=false]:fade-out-0",
						"data-[showing=false]:zoom-out-95",
						"data-[showing=true]:slide-in-from-bottom-1",
						"data-[showing=false]:slide-out-to-bottom-1",
					].join(" "),
					content: [
						"bg-secondary-100",
						"border border-white/10",
						"shadow-[0_0_20px_rgba(0,0,0,0.1)]",
						"dark:shadow-[0_0_20px_rgba(255,255,255,0.1)]",
					].join(" "),
				}}
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

function ItemCollections({ item }: { item: Item | undefined }) {
	const isCollectionsEnabled = useFeatureFlagEnabled("collections");
	const t = useTranslations("ui");

	if (!isCollectionsEnabled) return null;

	const collectionsAncestry = (item?.collectionsData as Collection[]) || [];

	const groupedCollections = collectionsAncestry.reduce(
		(acc, collection) => {
			const title = collection.title || "Unknown";
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
							<h4 className="text-base font-medium uppercase text-black/60 dark:text-white/60 mb-2">
								{title}
							</h4>
							<ul className="text-base text-black/60 dark:text-white/60 flex flex-wrap gap-2">
								{collections
									.filter(
										(collection) =>
											collection.originalFacet,
									)
									.map((collection) => (
										<ItemCollection
											key={collection.key}
											collection={collection}
											item={item}
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
	const validAttachments = item?.attachmentsData?.filter(isVisiblePdfAttachment);

	if (!validAttachments?.length) return null;

	return (
		<ItemPropertyRowWrapper title={t("itemAttachmentsTitle")}>
			<p className="text-black/60 dark:text-white/60">
				{t("itemAttachmentsDescription")}
			</p>
			<div className="flex flex-col gap-4">
				{validAttachments.map((attachment) => (
					<Attachment
						key={attachment.id}
						data={attachment}
						item={item!}
					/>
				))}
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

function ItemRelations({ item }: { item: Item | undefined }) {
	const t = useTranslations("ui");
	const relations = item?.relations as RelationsType;
	const [selectedTab, setSelectedTab] = useState("general");

	const descriptions: Record<string, string> = {
		general: t("relatedResourcesByCitation"),
		cites: t("citesResource"),
		citedBy: t("citedByResource"),
	};

	if (item?.groupExternalId === 1) return null;

	return (
		<div className="flex flex-col gap-4">
			<div className="w-full">
				<Relations
					value={item?.relations as RelationsType}
					selectedTab={selectedTab}
					onTabChange={setSelectedTab}
					showTabsOnly={true}
				/>
			</div>
			<p className="text-black/60 dark:text-white/60">
				{descriptions[selectedTab] || descriptions.general}
			</p>
			<Relations
				value={item?.relations as RelationsType}
				selectedTab={selectedTab}
				onTabChange={setSelectedTab}
				showContentOnly={true}
			/>
		</div>
	);
}

function useNotesDescription() {
	const t = useTranslations("ui");

	if (!NOTES_DESCRIPTION) return t("itemNotesDescription");
	if (NOTES_DESCRIPTION === "false") return null;
	if (
		NOTES_DESCRIPTION.charAt(0).toUpperCase() ===
		NOTES_DESCRIPTION.charAt(0)
	) {
		return NOTES_DESCRIPTION;
	}
	return t(NOTES_DESCRIPTION);
}

function ItemNotes({ item }: { item: Item | undefined }) {
	const t = useTranslations("ui");
	const notes = item?.attachmentsData?.filter(
		(attachment) =>
			attachment.itemType === "Note" &&
			attachment.note &&
			hasAnyTag(attachment.tags, PUBLISH_TAGS),
	);
	const links = item?.attachmentsData?.filter(
		(attachment) =>
			attachment.linkMode === "linked_url" &&
			attachment.url &&
			hasAnyTag(attachment.tags, PUBLISH_TAGS),
	);

	const notesDescription = useNotesDescription();

	if (!notes?.length && !links?.length) return null;

	return (
		<ItemPropertyRowWrapper title={"Notes"}>
			{notesDescription && (
				<p className="text-black/60 dark:text-white/60">
					{notesDescription}
				</p>
			)}
			<div className="flex flex-col gap-4">
				{notes?.map((note) => (
					<Card key={note.id} color="card" className="flex flex-col">
						<div
							className="[&_a]:text-link_light dark:[&_a]:text-link"
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
						key={link.id}
						href={link.url || ""}
						target="_blank"
						rel="noopener noreferrer"
						className="no-underline group"
					>
						<Card
							color="card"
							className="flex flex-col p-4 transition-colors hover:bg-accent/5 group-hover:border-accent/50"
						>
							<div className="flex items-center gap-2 text-link_light dark:text-link font-medium">
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
	const loading = data?.item ? false : loadingProp;
	const isNewResourcePageEnabled = useFeatureFlagEnabled("new-resource-page");

	useEffect(() => {
		document.dispatchEvent(
			new Event("ZoteroItemUpdated", { bubbles: true, cancelable: true }),
		);
	}, [data?.item]);

	if (!isNewResourcePageEnabled) {
		return <ItemOld data={data} loading={loading} />;
	}

	const item = transformItem(loading ? undefined : data?.item)!;

	return (
		<PageContainer>
			{item && <abbr className="unapi-id" title={item.key}></abbr>}
			<ResultsTranslationProvider items={item ? [item] : []} scope="record">
			<LoadingContext.Provider value={{ loading }}>
				<div className="flex flex-col gap-8">
					<div className="flex flex-col gap-4">
						<ItemHeader item={item} isLoading={loading} />
						<ItemTitle item={item} />
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
								{FUNDING_PARTNER && (
									<ItemResearchPartner item={item} />
								)}
								<ItemIdentifiers item={item} />
								<ItemDetails item={item} />
								<ItemTechnical item={item} />
							</div>
						</div>
					</div>
				</div>
			</LoadingContext.Provider>
			</ResultsTranslationProvider>
		</PageContainer>
	);
}
