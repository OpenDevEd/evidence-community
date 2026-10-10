"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { BookOpen01Icon, LinkSquare01Icon } from "@hugeicons/core-free-icons";
import { CoverImage } from "@/components/features/items/CoverImage";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import {
	forwardRef,
	type ComponentProps,
	type CSSProperties,
	type ReactNode,
} from "react";
import useSWR from "swr";

import type { ItemGetResponse } from "@/app/api/item/types";
import {
	InlineCitation,
	InlineCitationCard,
	InlineCitationCardBody,
	InlineCitationCardTrigger,
	InlineCitationSource,
} from "@/components/ai-elements/InlineCitation";
import CopyButton from "@/components/features/items/CopyButton";
import {
	PublicationHoverPreview,
	publicationPreviewData,
} from "@/components/features/items/PublicationHoverPreview";
import { Skeleton } from "@/components/nextui/Skeleton";
import { useLibraryItemUrl } from "@/hooks/useLibraryItemUrl";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { abstractPlainText } from "@/lib/abstract-text";
import { isVisiblePdfAttachment } from "@/lib/attachment-visibility";
import { fetcher } from "@/lib/utils";
import { twMerge } from "@/lib/tw-merge";

const pdfHrefPattern = /^\/lib\/([^/?#]+)\/download\/([^/?#]+)(?:[?#].*)?$/;

// Sized with an arbitrary length: NextUI merges these with its own tailwind-merge, which drops `text-citation`.
const copyLinkClassNames = {
	button: "!h-7 !min-w-0 !rounded-lg !border-0 !bg-transparent !px-1.5 text-[length:theme(fontSize.citation)] text-black/40 shadow-none hover:!bg-black/[0.045] hover:!text-black/65 dark:text-white/40 dark:hover:!bg-white/[0.07] dark:hover:!text-white/70",
	icon: "size-3",
	text: "leading-none",
};

const citationChipClassName =
	"not-prose group/chip mx-1 inline-flex h-6 items-center gap-1.5 rounded-full border border-black/[0.08] bg-white py-0 pl-[2px] pr-2 align-[0.08em] font-sans text-citation font-medium not-italic leading-none tracking-normal text-black/55 no-underline shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition-citation duration-200 ease-out hover:-translate-y-px hover:border-accent/40 hover:bg-accent/[0.06] hover:text-black/70 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] focus-visible:ring-2 focus-visible:ring-accent/25 motion-reduce:transform-none dark:border-white/10 dark:bg-white/[0.06] dark:text-white/60 dark:shadow-none dark:hover:border-accent/45 dark:hover:bg-accent/10 dark:hover:text-white/80";

function CitationCopyLink({
	href,
	itemKey,
}: {
	href: string;
	itemKey?: string;
}) {
	const { identity } = useLibraryConfig();
	const itemUrl = useLibraryItemUrl();
	const t = useTranslations("ui");
	return (
		<CopyButton
			content={
				itemKey
					? itemUrl(itemKey)
					: new URL(href, identity.baseUrl).toString()
			}
			text={t("copyLink")}
			textOnCopy={t("linkCopied")}
			classNames={copyLinkClassNames}
		/>
	);
}

function SiteFavicon({ className }: { className?: string }) {
	const { identity } = useLibraryConfig();
	return (
		<span
			aria-hidden="true"
			className={twMerge(
				"inline-block shrink-0 bg-contain bg-center bg-no-repeat bg-[image:var(--citation-icon-light)] dark:bg-[image:var(--citation-icon-dark)]",
				className,
			)}
			style={
				{
					"--citation-icon-light": `url("${identity.assets.faviconLight ?? identity.assets.favicon}")`,
					"--citation-icon-dark": `url("${identity.assets.faviconDark ?? identity.assets.favicon}")`,
				} as CSSProperties
			}
		/>
	);
}

function CitationChipContents({ children }: { children: ReactNode }) {
	return (
		<>
			<span
				aria-hidden="true"
				className="grid size-icon-md shrink-0 place-items-center rounded-full bg-accent/[0.12] text-accent transition-colors group-hover/chip:bg-accent group-hover/chip:text-white dark:bg-accent/20"
			>
				<HugeiconsIcon icon={BookOpen01Icon} className="size-icon-xs" />
			</span>
			{children}
		</>
	);
}

const CitationLinkChip = forwardRef<
	HTMLAnchorElement,
	ComponentProps<"a"> & { ariaLabel: string }
>(function CitationLinkChip({ children, ariaLabel, className, ...props }, ref) {
	return (
		<a
			ref={ref}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={ariaLabel}
			className={twMerge(citationChipClassName, className)}
			{...props}
		>
			<CitationChipContents>{children}</CitationChipContents>
		</a>
	);
});

function StaticCitationChip({
	children,
	ariaLabel,
}: {
	children: ReactNode;
	ariaLabel: string;
}) {
	return (
		<span aria-label={ariaLabel} className={citationChipClassName}>
			<CitationChipContents>{children}</CitationChipContents>
		</span>
	);
}

function SourcePageLabel({ page }: { page: string }) {
	return (
		<span className="inline-flex items-center gap-1.5">
			<span className="text-black/45 dark:text-white/45">Source</span>
			<span
				aria-hidden="true"
				className="h-3 w-px bg-black/10 dark:bg-white/15"
			/>
			<span className="font-semibold tabular-nums text-accent">
				p. {page}
			</span>
		</span>
	);
}

function publicationAuthors(item: ItemGetResponse["item"]) {
	const names = Array.isArray(item?.fullNames) ? item.fullNames : [];
	if (names.length === 0) return "";
	return names.length > 3
		? `${names.slice(0, 3).join(", ")} et al.`
		: names.join(", ");
}

function firstText(...values: Array<string | null | undefined>) {
	return values.find((value) => value?.trim())?.trim() ?? "";
}

/** The attachment the citation names, or the only readable PDF if it is stale. */
export function citedAttachment(
	item: ItemGetResponse["item"],
	attachmentKey: string,
) {
	const attachments = item?.attachmentsData ?? [];
	const named = attachments.find(
		(candidate) => candidate.key === attachmentKey,
	);
	if (named) return named;

	const visible = attachments.filter(isVisiblePdfAttachment);
	return visible.length === 1 ? visible[0] : undefined;
}

type CitedAttachment = ReturnType<typeof citedAttachment>;

/** What the citation card calls the file and its publication. */
export function citationNames({
	attachment,
	attachmentKey,
	documentLabel,
	item,
}: {
	attachment: CitedAttachment;
	attachmentKey: string;
	documentLabel: string;
	item: ItemGetResponse["item"];
}) {
	return {
		attachmentName:
			firstText(attachment?.filename, attachment?.title) ||
			`${attachmentKey}.pdf`,
		documentName:
			firstText(
				abstractPlainText(attachment?.title),
				attachment?.filename,
			) || documentLabel,
		title: firstText(abstractPlainText(item?.title)) || "-",
		authors: publicationAuthors(item),
	};
}

function PdfPreviewSkeleton() {
	return (
		<div className="flex flex-col gap-3 p-3">
			<div className="flex gap-3">
				<Skeleton className="h-24 w-16 shrink-0 rounded-xl" />
				<div className="flex min-w-0 flex-1 flex-col gap-2 py-1">
					<Skeleton className="h-4 w-full rounded-lg" />
					<Skeleton className="h-3 w-3/4 rounded-lg" />
					<Skeleton className="mt-auto h-8 w-full rounded-xl" />
				</div>
			</div>
			<Skeleton className="h-10 w-full rounded-xl" />
		</div>
	);
}

function PdfPreview({
	itemKey,
	attachmentKey,
	openHref,
	page,
}: {
	itemKey: string;
	attachmentKey: string;
	openHref: string;
	page: string;
}) {
	const t = useTranslations("ui");
	const { data, isLoading } = useSWR<ItemGetResponse>(
		`/item/${itemKey}`,
		fetcher,
		{ revalidateOnFocus: false },
	);

	if (isLoading) return <PdfPreviewSkeleton />;

	const item = data?.item;
	const attachment = citedAttachment(item, attachmentKey);
	const { attachmentName, authors, documentName, title } = citationNames({
		attachment,
		attachmentKey,
		documentLabel: t("document"),
		item,
	});

	return (
		<div className="flex flex-col p-3">
			<div className="flex gap-3">
				<PdfCover
					coverImage={attachment?.PDFCoverPageImage}
					filename={attachmentName}
				/>
				<div className="flex min-w-0 flex-1 flex-col">
					<p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-black/80 dark:text-white/85">
						{documentName}
					</p>
					<div className="mt-1 flex items-center justify-between gap-2">
						<p className="text-xs font-medium text-accent">
							{t("pageNumber", { page })}
						</p>
						<CitationCopyLink href={openHref} />
					</div>

					<PdfOpenLink href={openHref} />
				</div>
			</div>

			{item && (
				<PublicationStrip
					itemKey={itemKey}
					title={title}
					authors={authors}
				/>
			)}
		</div>
	);
}

function PdfOpenLink({ href }: { href: string }) {
	const t = useTranslations("ui");

	return (
		<div className="mt-auto flex pt-2">
			<a
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-black/[0.055] px-2 text-xs font-semibold text-black/65 no-underline transition-colors hover:bg-accent/[0.12] hover:text-accent dark:bg-white/[0.08] dark:text-white/70 dark:hover:bg-accent/[0.15] dark:hover:text-accent"
			>
				<HugeiconsIcon icon={LinkSquare01Icon} className="size-3.5" aria-hidden="true" />
				{t("openDocument")}
			</a>
		</div>
	);
}

function PdfCover({
	coverImage,
	filename,
}: {
	coverImage?: string | null;
	filename: string;
}) {
	const t = useTranslations("ui");

	return (
		<div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-xl border border-black/[0.06] bg-accent/10 dark:border-white/10">
			{coverImage ? (
				<CoverImage
					src={coverImage}
					alt={t("pdfPreviewAlt", { filename })}
					fill
					sizes="64px"
					className="object-cover"
				/>
			) : (
				<div className="flex h-full items-center justify-center text-accent/70">
					<HugeiconsIcon icon={BookOpen01Icon} className="size-6" aria-hidden="true" />
				</div>
			)}
		</div>
	);
}

function PublicationStrip({
	itemKey,
	title,
	authors,
}: {
	itemKey: string;
	title: string;
	authors: string;
}) {
	return (
		<div className="mt-3 border-t border-black/[0.06] pt-2.5 dark:border-white/[0.08]">
			<Link
				href={`/lib/${itemKey}`}
				target="_blank"
				rel="noopener noreferrer"
				className="group/publication flex min-w-0 flex-1 items-start gap-2 rounded-lg px-1 py-1 no-underline transition-colors hover:bg-accent/[0.08] dark:hover:bg-accent/[0.12]"
			>
				<SiteFavicon className="mt-0.5 size-3.5 shrink-0 rounded-favicon opacity-80 ring-1 ring-black/[0.06] group-hover/publication:opacity-100 dark:ring-white/10" />
				<span className="flex min-w-0 flex-col">
					<span className="line-clamp-2 text-xs font-medium leading-snug text-black/75 transition-colors group-hover/publication:text-accent dark:text-white/75">
						{title}
					</span>
					{authors && (
						<span className="mt-0.5 min-w-0 truncate text-citation text-black/45 dark:text-white/45">
							{authors}
						</span>
					)}
				</span>
			</Link>
		</div>
	);
}

export function PublicationLinkPreview({
	itemKey,
	href,
}: {
	itemKey: string;
	href: string;
}) {
	const t = useTranslations("ui");
	const formatter = useFormatter();
	const { content, identity, institutions } = useLibraryConfig();
	const { data, isLoading } = useSWR<ItemGetResponse>(
		`/item/${itemKey}`,
		fetcher,
		{ revalidateOnFocus: false },
	);

	if (isLoading) {
		return (
			<div className="flex w-full flex-col gap-2 p-3">
				<Skeleton className="h-4 w-4/5 rounded-lg" />
				<Skeleton className="h-3 w-3/5 rounded-lg" />
				<Skeleton className="h-12 w-full rounded-xl" />
			</div>
		);
	}

	if (!data?.item) return null;

	return (
		<div className="relative p-3">
			{/* The whole card opens the publication in a new tab. The copy button stays a control of its own, above the link. */}
			<Link
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={data.item.title ?? undefined}
				className="absolute inset-0 rounded-[inherit] transition-colors hover:bg-black/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus dark:hover:bg-white/[0.04]"
			/>
			<div className="pointer-events-none relative mb-2 flex items-center justify-between gap-3 border-b border-black/[0.06] pb-2 dark:border-white/[0.08]">
				<span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-black/45 dark:text-white/45">
					<SiteFavicon className="size-3.5 rounded-favicon" />
					<span className="truncate">{identity.name}</span>
				</span>
				<span className="pointer-events-auto"><CitationCopyLink href={href} itemKey={itemKey} /></span>
			</div>
			<div className="pointer-events-none relative">
			<PublicationHoverPreview
				preview={publicationPreviewData(data.item, {
					contentTags: content.tags,
					etAl: t("etAl"),
					formatter,
					institutions,
				})}
				comingSoonLabel={t("inProgress")}
				institutionAlt={(name) => t("institutionLogoAlt", { name })}
				internalLabel={t("internal")}
				noAbstractLabel={t("noAbstract")}
			/>
			</div>
		</div>
	);
}

/**
 * A link the assistant wrote to a publication in this library: marked with
 * the library's own icon, and previewed on hover.
 */
export function PublicationLink({
	href,
	itemKey,
	children,
}: {
	href: string;
	itemKey: string;
	children: ReactNode;
}) {
	return (
		<InlineCitation className="inline align-baseline">
			<InlineCitationCard>
				<InlineCitationCardTrigger>
					<Link
						href={href}
						target="_blank"
						rel="noopener noreferrer"
						className="group/library-link -mx-0.5 rounded-[0.35rem] px-0.5 py-px font-medium text-accent no-underline decoration-accent/35 decoration-1 underline-offset-[0.18em] box-decoration-clone transition-[color,background-color,text-decoration-color] duration-200 ease-out hover:bg-accent/[0.09] hover:text-accent-600 hover:decoration-accent focus-visible:bg-accent/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 motion-reduce:transition-none dark:hover:bg-accent/[0.12] dark:hover:text-accent-300"
					>
						<SiteFavicon className="me-1 size-3.5 rounded-favicon align-[-0.12em] opacity-75 ring-1 ring-black/[0.06] transition-[opacity,transform] duration-200 ease-out group-hover/library-link:-translate-y-px group-hover/library-link:opacity-100 motion-reduce:transform-none motion-reduce:transition-none dark:ring-white/10" />
						<span className="underline decoration-inherit">
							{children}
						</span>
					</Link>
				</InlineCitationCardTrigger>
				<InlineCitationCardBody className="w-96 max-w-[calc(100vw-1.5rem)]">
					<InlineCitationSource>
						<PublicationLinkPreview itemKey={itemKey} href={href} />
					</InlineCitationSource>
				</InlineCitationCardBody>
			</InlineCitationCard>
		</InlineCitation>
	);
}

/**
 * One citation control showing both the publication source and the exact
 * page. Hovering it previews the cited PDF; clicking opens that page.
 */
export function PageCitation({ href, page }: { href?: string; page: string }) {
	const match = href?.match(pdfHrefPattern);
	if (!href || !match) {
		return (
			<StaticCitationChip
				ariaLabel={`Citation source unavailable at page ${page}`}
			>
				<SourcePageLabel page={page} />
			</StaticCitationChip>
		);
	}

	return (
		<InlineCitation>
			<InlineCitationCard>
				<InlineCitationCardTrigger>
					<CitationLinkChip
						href={href}
						ariaLabel={`Open citation source at page ${page}`}
					>
						<SourcePageLabel page={page} />
					</CitationLinkChip>
				</InlineCitationCardTrigger>
				<InlineCitationCardBody className="w-96 max-w-[calc(100vw-1.5rem)]">
					<InlineCitationSource>
						<PdfPreview
							itemKey={match[1]}
							attachmentKey={match[2]}
							openHref={href}
							page={page}
						/>
					</InlineCitationSource>
				</InlineCitationCardBody>
			</InlineCitationCard>
		</InlineCitation>
	);
}
