"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import {
	ArrowLeft01Icon,
	ArrowRight01Icon,
	Calendar01Icon,
	CalendarClockIcon,
	Download01Icon,
	File02Icon,
	ArrowDownLeft01Icon,
} from "@hugeicons/core-free-icons";
import { Item } from "@/app/api/item/types";
import { Button } from "@/components/nextui/Button";
import { Skeleton } from "@/components/nextui/Skeleton";
import { Link, usePathname } from "@/i18n/routing";
import { useResourceHref } from "@/hooks/useResourceHref";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Card } from "@/components/nextui/Card";
import { DownloadButton } from "@/components/features/newlib/DownloadModal";
import CopyButton from "@/components/features/newlib/CopyButton";
import LikeButton from "@/components/features/items/LikeButton";
import { AddButton } from "@/components/features/items/Resource";
import ZoteroDropdown from "@/components/features/newlib/ZoteroDropdown";
import AiWrapper from "@/components/features/newlib/AiWrapper";
import { hasAnyTag } from "@/lib/tags";
import GapMapAction from "@/components/features/gapmaps/GapMapAction";
import { useLibraryItemUrl } from "@/hooks/useLibraryItemUrl";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { FuturePublicationHint } from "@/components/features/items/FuturePublicationHint";
import { StudyTypeLabel } from "@/components/features/items/StudyTypeLabel";
import { isFuturePublication } from "@/lib/bibliographic-date";
import { OpenAccessLabel } from "@/components/features/items/OpenAccessLabel";
import { EvidenceVerdict, VisualizeButton } from "@/components/pages/evidence/record-evidence";

/** The record's study type in the header, once it has been read. */
function ItemStudyType({ reading }: { reading: Item["reading"] }) {
	if (!reading) return null;
	return (
		<HeaderSection>
			<StudyTypeLabel reading={reading} className="gap-2 text-base" />
		</HeaderSection>
	);
}

function getCitationCount(item: Item | undefined) {
	if (!item) return 0;
	return item.links?.citedBy.length ?? 0;
}

function ItemCitationButton({
	count,
	href,
	isCitationPage,
}: {
	count: number;
	href: string;
	isCitationPage: boolean;
}) {
	const t = useTranslations("ui");
	if (count === 0) return null;
	return (
		<Button
			as={Link}
			href={href}
			// /citation/ is closed to crawlers (robots.ts), so they are told not to follow it, as a card's counts are.
			rel="nofollow"
			size="sm"
			color={isCitationPage ? "accent" : "secondary"}
			startContent={
				<HugeiconsIcon icon={ArrowDownLeft01Icon} className="size-4" />
			}
			endContent={
				<HugeiconsIcon
					icon={ArrowRight01Icon}
					className={`size-3 opacity-50 ${isCitationPage ? "rotate-180" : ""}`}
				/>
			}
		>
			<span className="font-bold">{count}</span>
			<span className="opacity-80 font-normal">
				{t("libraryCitationLabel", { count })}
			</span>
		</Button>
	);
}

function formatInstitutions(institutions: string[] | undefined) {
	if (!institutions || institutions.length === 0) return "";
	if (institutions.length === 1) return institutions[0];
	return `${institutions[0]} +${institutions.length - 1} others`;
}

function HeaderSection({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex items-center gap-2 text-black/60 dark:text-white/60">
			{children}
		</div>
	);
}

export function ItemHeaderYear({
	year,
	datePublished,
}: {
	year?: string | null;
	datePublished?: string | null;
}) {
	if (!year) return null;
	if (!isFuturePublication({ year, datePublished })) {
		return (
			<HeaderSection>
				<HugeiconsIcon
					icon={Calendar01Icon}
					className="size-4"
					aria-hidden="true"
				/>
				{year}
			</HeaderSection>
		);
	}

	return (
		<HeaderSection>
			<FuturePublicationHint className="gap-2">
				<HugeiconsIcon
					icon={CalendarClockIcon}
					className="size-4"
					aria-hidden="true"
				/>
				{year}
			</FuturePublicationHint>
		</HeaderSection>
	);
}

function ItemHeaderInstitution({ item }: { item: Item | undefined }) {
	if (!item?.institution?.length) return null;
	return (
		<Card className="p-1 px-3 text-sm bg-default-100 select-none">
			{formatInstitutions(item?.institution as string[])}
		</Card>
	);
}

function ItemHeaderInternal({ item }: { item: Item | undefined }) {
	const tLabels = useTranslations("item");
	const { content } = useLibraryConfig();
	if (!hasAnyTag(item?.tags, content.tags.internal)) return null;
	return (
		<Card className="p-1 px-3 text-sm bg-default-100 select-none">
			{tLabels("availableOnRequest")}
		</Card>
	);
}

function ItemHeaderActions({
	item,
	isCitationPage,
	isLoading,
}: {
	item: Item | undefined;
	isCitationPage: boolean;
	isLoading: boolean;
}) {
	const t = useTranslations("ui");
	const itemUrl = useLibraryItemUrl();
	const resourceHref = useResourceHref();

	return (
		<div className="ltr:ml-auto rtl:mr-auto flex flex-row-reverse items-center gap-2 flex-wrap">
			<DownloadButton
				size="sm"
				fileName={item?.key || ""}
				isIconOnly
				itemData={item}
				startContent={<HugeiconsIcon icon={Download01Icon} />}
				aria-label={t("itemDownloadAriaLabel")}
			/>
			<GapMapAction tags={item?.tags} size="sm" />
			<VisualizeButton item={item} />
			<CopyButton textToCopy={item ? itemUrl(item.key) : ""} label={t("copyLink")}>
				<Button size="sm" aria-label={t("itemCopyUrlAriaLabel")}>
					{t("copyLink")}
				</Button>
			</CopyButton>
			<LikeButton itemData={item} aria-label={t("itemLikeAriaLabel")} />
			<AddButton
				itemData={item}
				aria-label={t("itemAddToCollectionAriaLabel")}
			/>
			<ZoteroDropdown
				item={item}
				aria-label={t("itemZoteroOptionsAriaLabel")}
			/>
			{!isLoading && <AiWrapper data={{ item }} variant="inline" />}
			<ItemCitationButton
				count={getCitationCount(item)}
				href={resourceHref(item?.key ?? "", {
					base: isCitationPage ? "/lib" : "/citation",
				})}
				isCitationPage={isCitationPage}
			/>
		</div>
	);
}

export default function ItemHeader({
	item,
	isLoading,
}: {
	item: Item | undefined;
	isLoading: boolean;
}) {
	const router = useRouter();
	const tItemType = useTranslations("itemType");
	const t = useTranslations("ui");

	const handleBack = () => {
		if (window.history.length <= 1) {
			router.push("/");
		} else {
			router.back();
		}
	};

	const pathname = usePathname();
	const isCitationPage = pathname.includes(`/citation/${item?.key}`);

	return (
		<div className="w-full flex items-center gap-4 flex-wrap">
			<Skeleton isLoaded={!isLoading} className="rounded-2xl w-full">
				<div className="flex items-center gap-4 flex-wrap">
					<Button
						variant="transparent"
						size="sm"
						className="rounded-2xl"
						onPress={handleBack}
						startContent={
							<HugeiconsIcon
								icon={ArrowLeft01Icon}
								className="rtl:rotate-180"
							/>
						}
						aria-label={t("itemBackAriaLabel")}
					>
						{t("itemBack")}
					</Button>
					<ItemHeaderInstitution item={item} />
					<ItemHeaderInternal item={item} />
					<div className="flex items-center gap-4 flex-wrap">
						<ItemHeaderYear
							year={item?.year}
							datePublished={item?.datePublished}
						/>

						<HeaderSection>
							<HugeiconsIcon
								icon={File02Icon}
								className="size-4"
							/>
							{item?.itemType ? tItemType(item?.itemType) : "-"}
						</HeaderSection>
						<ItemStudyType reading={item?.reading} />
						<OpenAccessLabel openAccess={item?.openAccess} className="gap-2" />
						<EvidenceVerdict item={item} />
					</div>
					<ItemHeaderActions
						item={item}
						isCitationPage={isCitationPage}
						isLoading={isLoading}
					/>
				</div>
			</Skeleton>
		</div>
	);
}
