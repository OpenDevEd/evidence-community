"use client";

import Image from "next/image";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { BiBookOpen } from "react-icons/bi";
import { LuDownload, LuExternalLink } from "react-icons/lu";
import useSWR from "swr";
import { isVisiblePdfAttachment } from "@/lib/attachment-visibility";
import { twMerge } from "tailwind-merge";
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
import type { ItemGetResponse } from "@/app/api/item/types";
import { downloadFile } from "@/lib/download";
import { fetcher, parseCompanyName } from "@/lib/utils";
import { zoteroMarkupToSingleLine } from "@/lib/zoteroMarkup";
import { useStatus } from "@/context/Providers";

const pdfHrefPattern =
	/^\/lib\/([^/?#]+)\/download\/([^/?#]+)(?:[?#].*)?$/;
const SITE_FAVICON_URL = "/favicon.ico";

const copyLinkClassNames = {
	button:
		"!h-7 !min-w-0 !rounded-lg !border-0 !bg-transparent !px-1.5 text-[0.68rem] text-black/40 shadow-none hover:!bg-black/[0.045] hover:!text-black/65 dark:text-white/40 dark:hover:!bg-white/[0.07] dark:hover:!text-white/70",
	icon: "size-3",
	text: "leading-none",
};

function absoluteLink(href: string) {
	return new URL(href, window.location.origin).toString();
}

function CitationCopyLink({ href }: { href: string }) {
	const t = useTranslations("ui");
	return (
		<CopyButton
			content={() => absoluteLink(href)}
			text={t("copyLink")}
			textOnCopy={t("linkCopied")}
			classNames={copyLinkClassNames}
		/>
	);
}

function SiteFavicon({ className }: { className?: string }) {
	return (
		<span
			aria-hidden="true"
			className={twMerge(
				"inline-block shrink-0 bg-contain bg-center bg-no-repeat",
				className,
			)}
			style={{ backgroundImage: `url('${SITE_FAVICON_URL}')` }}
		/>
	);
}

function PublicationLinkPreview({
	itemKey,
	href,
}: {
	itemKey: string;
	href: string;
}) {
	const t = useTranslations("ui");
	const status = useStatus();
	const { companyName } = parseCompanyName(status?.companyName);
	const formatter = useFormatter();
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
	const preview = publicationPreviewData(
		data.item,
		formatter,
		t("etAl"),
	);

	return (
		<div className="p-3">
			<div className="mb-2 flex items-center justify-between gap-3 border-b border-black/[0.06] pb-2 dark:border-white/[0.08]">
				<span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-black/45 dark:text-white/45">
					<SiteFavicon className="size-3.5 rounded-[0.2rem]" />
					<span className="truncate">{companyName}</span>
				</span>
				<CitationCopyLink href={href} />
			</div>
			<PublicationHoverPreview
				preview={preview}
				comingSoonLabel={t("inProgress")}
				internalLabel={t("internal")}
				noAbstractLabel={t("noAbstract")}
			/>
		</div>
	);
}

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
						<SiteFavicon className="me-1 size-3.5 rounded-[0.2rem] align-[-0.12em] opacity-75 ring-1 ring-black/[0.06] transition-[opacity,transform] duration-200 ease-out group-hover/library-link:-translate-y-px group-hover/library-link:opacity-100 motion-reduce:transform-none motion-reduce:transition-none dark:ring-white/10" />
						<span className="underline decoration-inherit">{children}</span>
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

const citationChipClassName =
	"not-prose group/chip mx-1 inline-flex h-6 items-center gap-1.5 rounded-full border border-black/[0.08] bg-white py-0 pl-[2px] pr-2 align-[0.08em] font-sans text-[0.68rem] font-medium not-italic leading-none tracking-normal text-black/55 no-underline shadow-[0_1px_2px_rgba(0,0,0,0.04)] outline-none transition-[transform,border-color,background-color,box-shadow,color] duration-200 ease-out hover:-translate-y-px hover:border-accent/40 hover:bg-accent/[0.06] hover:text-black/70 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] focus-visible:ring-2 focus-visible:ring-accent/25 motion-reduce:transform-none dark:border-white/10 dark:bg-white/[0.06] dark:text-white/60 dark:shadow-none dark:hover:border-accent/45 dark:hover:bg-accent/10 dark:hover:text-white/80";

function CitationChipContents({ children }: { children: ReactNode }) {
	return (
		<>
			<span
				aria-hidden="true"
				className="grid size-[18px] shrink-0 place-items-center rounded-full bg-accent/[0.12] text-accent transition-colors group-hover/chip:bg-accent group-hover/chip:text-white dark:bg-accent/20"
			>
				<BiBookOpen className="size-[11px]" />
			</span>
			{children}
		</>
	);
}

const CitationLinkChip = forwardRef<
	HTMLAnchorElement,
	ComponentProps<"a"> & { ariaLabel: string }
>(function CitationLinkChip(
	{
		children,
		ariaLabel,
		className,
		...props
	},
	ref,
) {
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
	const formatter = useFormatter();
	const { data, isLoading } = useSWR<ItemGetResponse>(
		`/item/${itemKey}`,
		fetcher,
		{ revalidateOnFocus: false },
	);
	const item = data?.item;
	// Mirror the download route: an unknown attachment key resolves to the
	// publication's single visible PDF (stale/invented keys from the model).
	const attachment =
		item?.attachmentsData?.find(
			(candidate) => candidate.key === attachmentKey,
		) ??
		(() => {
			const visible = (item?.attachmentsData ?? []).filter(
				isVisiblePdfAttachment,
			);
			return visible.length === 1 ? visible[0] : undefined;
		})();
	const preview = item
		? publicationPreviewData(item, formatter, t("etAl"))
		: null;
	const attachmentName =
		attachment?.filename || attachment?.title || `${attachmentKey}.pdf`;
	const documentName =
		zoteroMarkupToSingleLine(attachment?.title) ||
		attachment?.filename ||
		t("document");
	const publicationHref = `/lib/${itemKey}`;

	if (isLoading) {
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

	return (
		<div className="flex flex-col p-3">
			<div className="flex gap-3">
				<div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-xl border border-black/[0.06] bg-accent/10 dark:border-white/10">
					{attachment?.PDFCoverPageImage ? (
						<Image
							src={attachment.PDFCoverPageImage}
							alt={t("pdfPreviewAlt", { filename: attachmentName })}
							fill
							sizes="64px"
							className="object-cover transition-transform duration-300 group-hover/citation:scale-[1.03]"
						/>
					) : (
						<div className="flex h-full items-center justify-center text-accent/70">
							<BiBookOpen className="size-6" aria-hidden="true" />
						</div>
					)}
				</div>

				<div className="flex min-w-0 flex-1 flex-col">
					<p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-black/80 dark:text-white/85">
						{documentName}
					</p>
					<div className="mt-1 flex items-center justify-between gap-2">
						<p className="text-xs font-medium text-accent">Page {page}</p>
						<CitationCopyLink href={openHref} />
					</div>

					<div className="mt-auto flex gap-2 pt-2">
						<a
							href={openHref}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-black/[0.055] px-2 text-xs font-semibold text-black/65 no-underline transition-colors hover:bg-accent/[0.12] hover:text-accent dark:bg-white/[0.08] dark:text-white/70 dark:hover:bg-accent/[0.15] dark:hover:text-accent"
						>
							<LuExternalLink className="size-3.5" aria-hidden="true" />
							{t("openDocument")}
						</a>
						<button
							type="button"
							disabled={!attachment?.url}
							onClick={() => {
								if (!attachment?.url) return;
								downloadFile(attachment.url, attachmentName).catch(console.error);
							}}
							className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-2 text-xs font-semibold text-white transition-colors hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-40"
						>
							<LuDownload className="size-3.5" aria-hidden="true" />
							{t("download")}
						</button>
					</div>
				</div>
			</div>

			{preview && (
				<div className="mt-3 border-t border-black/[0.06] pt-2.5 dark:border-white/[0.08]">
					<Link
						href={publicationHref}
						target="_blank"
						rel="noopener noreferrer"
						className="group/publication flex min-w-0 flex-1 items-start gap-2 rounded-lg px-1 py-1 no-underline transition-colors hover:bg-accent/[0.08] dark:hover:bg-accent/[0.12]"
					>
						<SiteFavicon className="mt-0.5 size-3.5 shrink-0 rounded-[0.2rem] opacity-80 ring-1 ring-black/[0.06] group-hover/publication:opacity-100 dark:ring-white/10" />
						<span className="flex min-w-0 flex-col">
							<span className="line-clamp-2 text-xs font-medium leading-snug text-black/75 transition-colors group-hover/publication:text-accent dark:text-white/75">
								{preview.title}
							</span>
							{(preview.authors || preview.fullDate) && (
								<span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[0.68rem] text-black/45 dark:text-white/45">
									{preview.authors && (
										<span className="min-w-0 truncate">{preview.authors}</span>
									)}
									{preview.authors && preview.fullDate && (
										<span className="text-black/25 dark:text-white/25">·</span>
									)}
									{preview.fullDate && (
										<span className="shrink-0">{preview.fullDate}</span>
									)}
								</span>
							)}
						</span>
					</Link>
				</div>
			)}
		</div>
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

export function PageCitation({
	href,
	page,
}: {
	href?: string;
	page: string;
}) {
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
