"use client";

import type { useFormatter } from "next-intl";
import { twMerge } from "tailwind-merge";
import { COMING_SOON_TAG, INSTITUTION_LOGOS, INTERNAL_TAG } from "@/constants/items";
import { hasTag } from "@/lib/tags";
import { zoteroMarkupToSingleLine } from "@/lib/zoteroMarkup";

type Formatter = ReturnType<typeof useFormatter>;

function toInitials(name: string): string {
	if (!name) return "";
	const initials = name
		.split(" ")
		.map((part) => part[0])
		.filter(Boolean)
		.join(". ");
	return initials ? `${initials}.` : "";
}

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
	const first = creators.find((author: any) => author?.lastName || author?.name);
	return first ? `${authorString(first)} ${etAl}` : "";
}

function getOrgLogo(item: any): any {
	const raw = Array.isArray(item?.institution)
		? item.institution
		: item?.institution
			? [item.institution]
			: [];
	const institutions = raw.filter(Boolean) as string[];
	if (!institutions.length) return null;
	const withLogo = institutions.find((institution) =>
		Object.keys(INSTITUTION_LOGOS).some((key) => institution.includes(key)),
	);
	const selected = withLogo || institutions[0];
	const entry = Object.entries(INSTITUTION_LOGOS).find(([key]) =>
		selected.includes(key),
	);
	return entry?.[1] ?? null;
}

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

export type PublicationPreviewData = {
	title: string;
	abstract: string;
	authors: string;
	fullDate: string;
	OrgLogo: any;
	isComingSoon: boolean;
	isInternal: boolean;
};

export function publicationPreviewData(
	item: any,
	formatter: Formatter,
	etAl: string,
): PublicationPreviewData {
	return {
		title: zoteroMarkupToSingleLine(item?.title) || "-",
		abstract: zoteroMarkupToSingleLine(item?.abstractNote),
		authors: formatAuthors(item, etAl),
		fullDate: formatFullDate(item, formatter),
		OrgLogo: getOrgLogo(item),
		isComingSoon: hasTag(item?.tags, COMING_SOON_TAG),
		isInternal: hasTag(item?.tags, INTERNAL_TAG),
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

export function PublicationHoverPreview({
	preview,
	comingSoonLabel,
	internalLabel,
	noAbstractLabel,
}: {
	preview: PublicationPreviewData;
	comingSoonLabel: string;
	internalLabel: string;
	noAbstractLabel: string;
}) {
	const {
		title,
		abstract,
		authors,
		fullDate,
		OrgLogo,
		isComingSoon,
		isInternal,
	} = preview;

	return (
		<div className="flex max-w-sm flex-col gap-1.5 px-1 py-1">
			<div className="line-clamp-3 text-sm font-medium text-black/80 dark:text-white/80">
				{title}
			</div>
			{(authors || OrgLogo || fullDate || isComingSoon || isInternal) && (
				<div className="flex flex-col gap-1.5 text-xs">
					{(OrgLogo || authors || fullDate) && (
						<div className="flex items-center gap-1.5">
							{OrgLogo && <OrgLogo />}
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
					)}
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
