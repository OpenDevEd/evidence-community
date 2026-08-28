"use client";

import type { useFormatter } from "next-intl";
import { twMerge } from "tailwind-merge";

import { InstitutionLogo } from "@/components/library/LibraryIdentity";
import { findInstitutionWithLogo } from "@/config/library-config/institutions";
import type { LibraryPublicConfig } from "@/config/library-config/schema";
import { abstractPlainText } from "@/lib/abstract-text";
import { hasAnyTag } from "@/lib/tags";

type Formatter = ReturnType<typeof useFormatter>;
type Institutions = LibraryPublicConfig["institutions"];
type ContentTags = LibraryPublicConfig["content"]["tags"];

export type PublicationPreviewData = {
	title: string;
	abstract: string;
	authors: string;
	fullDate: string;
	institution: ReturnType<typeof findInstitutionWithLogo>;
	isComingSoon: boolean;
	isInternal: boolean;
};

function formatFullDate(item: any, formatter: Formatter): string {
	const value = item?.datePublished || item?.date;
	if (!value) return "";
	const parsed = new Date(value);
	if (isNaN(parsed.getTime())) {
		return typeof value === "string" ? value : "";
	}
	return formatter.dateTime(parsed, {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

function toInitials(name: string): string {
	if (!name) return "";
	const initials = name
		.split(" ")
		.map((part) => part[0])
		.filter(Boolean)
		.join(". ");
	return initials ? `${initials}.` : "";
}

// APA-style author byline, matching how the results card formats authors.
function formatAuthors(item: any, etAl: string): string {
	const creators = Array.isArray(item?.creators) ? item.creators : [];
	if (!creators.length) return "";
	const authorString = (author: any) =>
		author?.name ||
		[author?.lastName, toInitials(author?.firstName)]
			.filter(Boolean)
			.join(", ");
	if (creators.length <= 2) {
		return creators.map(authorString).filter(Boolean).join(" & ");
	}
	const first = creators.find(
		(author: any) => author?.lastName || author?.name,
	);
	return first ? `${authorString(first)} ${etAl}` : "";
}

/** Everything the small preview card shows about one publication. */
export function publicationPreviewData(
	item: any,
	{
		contentTags,
		etAl,
		formatter,
		institutions,
	}: {
		contentTags: ContentTags;
		etAl: string;
		formatter: Formatter;
		institutions: Institutions;
	},
): PublicationPreviewData {
	return {
		title: abstractPlainText(item?.title) || "-",
		abstract: abstractPlainText(item?.abstractNote),
		authors: formatAuthors(item, etAl),
		fullDate: formatFullDate(item, formatter),
		institution: findInstitutionWithLogo(institutions, item?.institution),
		isComingSoon: hasAnyTag(item?.tags, contentTags.comingSoon),
		isInternal: hasAnyTag(item?.tags, contentTags.internal),
	};
}

export function PublicationStatusBadges({
	comingSoon,
	internal,
	comingSoonLabel,
	internalLabel,
	fullWidth = false,
}: {
	comingSoon: boolean;
	internal: boolean;
	comingSoonLabel: string;
	internalLabel: string;
	fullWidth?: boolean;
}) {
	if (!comingSoon && !internal) return null;
	const widthClass = fullWidth ? "w-full text-center" : "shrink-0";

	return (
		<>
			{comingSoon && (
				<span
					className={twMerge(
						"rounded-lg border border-accent bg-black/10 px-2 py-0.5 text-xs font-medium text-accent",
						widthClass,
					)}
				>
					{comingSoonLabel}
				</span>
			)}
			{internal && (
				<span
					className={twMerge(
						"rounded-lg border border-danger bg-black/10 px-2 py-0.5 text-xs font-medium text-danger",
						widthClass,
					)}
				>
					{internalLabel}
				</span>
			)}
		</>
	);
}

export function PreviewInstitutionLogo({
	institution,
	institutionAlt,
	size = "badge",
}: {
	institution: PublicationPreviewData["institution"];
	institutionAlt: (name: string) => string;
	size?: "badge" | "small";
}) {
	if (!institution?.logoUrl) return null;

	return (
		<InstitutionLogo
			alt={institutionAlt(institution.name)}
			logoUrl={institution.logoUrl}
			size={size}
		/>
	);
}

function PreviewByline({
	preview,
	institutionAlt,
}: {
	preview: PublicationPreviewData;
	institutionAlt: (name: string) => string;
}) {
	const { authors, fullDate, institution } = preview;
	if (![institution, authors, fullDate].some(Boolean)) return null;

	return (
		<div className="flex items-center gap-1.5">
			<PreviewInstitutionLogo
				institution={institution}
				institutionAlt={institutionAlt}
			/>
			{authors && (
				<span className="min-w-0 truncate font-medium text-black/70 dark:text-white/70">
					{authors}
				</span>
			)}
			{authors && fullDate && (
				<span className="text-black/25 dark:text-white/25">·</span>
			)}
			{fullDate && (
				<span className="shrink-0 text-black/40 dark:text-white/40">
					{fullDate}
				</span>
			)}
		</div>
	);
}

/** The card shown when someone hovers a publication in search or in chat. */
export function hasPreviewDetails(preview: PublicationPreviewData) {
	return [
		preview.abstract,
		preview.authors,
		preview.fullDate,
		preview.isComingSoon,
		preview.isInternal,
	].some(Boolean);
}

export function hasBylineDetails(preview: PublicationPreviewData) {
	return [
		preview.institution,
		preview.authors,
		preview.isComingSoon,
		preview.isInternal,
	].some(Boolean);
}

export function PublicationHoverPreview({
	preview,
	comingSoonLabel,
	institutionAlt,
	internalLabel,
	noAbstractLabel,
}: {
	preview: PublicationPreviewData;
	comingSoonLabel: string;
	institutionAlt: (name: string) => string;
	internalLabel: string;
	noAbstractLabel: string;
}) {
	const { abstract, isComingSoon, isInternal, title } = preview;
	const hasDetails = hasPreviewDetails(preview);

	return (
		<div className="flex max-w-sm flex-col gap-1.5 px-1 py-1">
			<div className="line-clamp-3 text-sm font-medium text-black/80 dark:text-white/80">
				{title}
			</div>
			{hasDetails && (
				<div className="flex flex-col gap-1.5 text-xs">
					<PreviewByline
						preview={preview}
						institutionAlt={institutionAlt}
					/>
					{(isComingSoon || isInternal) && (
						<div className="flex flex-col gap-1.5">
							<PublicationStatusBadges
								comingSoon={isComingSoon}
								internal={isInternal}
								comingSoonLabel={comingSoonLabel}
								internalLabel={internalLabel}
								fullWidth
							/>
						</div>
					)}
				</div>
			)}
			{abstract ? (
				<p className="line-clamp-3 text-xs leading-relaxed text-black/55 dark:text-white/55">
					{abstract}
				</p>
			) : (
				<p className="text-xs italic text-black/35 dark:text-white/35">
					{noAbstractLabel}
				</p>
			)}
		</div>
	);
}
