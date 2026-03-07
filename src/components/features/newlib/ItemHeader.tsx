"use client";

import { Item } from "@/app/api/item/types";
import { Button } from "@/components/heroui/Button";
import { Skeleton } from "@/components/heroui/Skeleton";
import { Link, usePathname } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { BsQuote } from "react-icons/bs";
import { FaCalendar } from "react-icons/fa";
import { IoChevronBack, IoChevronForward, IoDocumentText } from "react-icons/io5";
import { LuDownload } from "react-icons/lu";
import { RelationsType } from "@/types/item";
import { INTERNAL_TAG } from "@/constants/items";
import { Card } from "@/components/heroui/Card";
import { DownloadButton } from "@/components/features/newlib/DownloadModal";
import CopyButton from "@/components/features/newlib/CopyButton";
import LikeButton from "@/components/features/items/LikeButton";
import { AddButton } from "@/components/features/items/Resource";
import ZoteroDropdown from "@/components/features/newlib/ZoteroDropdown";
import AiWrapper from "@/components/features/newlib/AiWrapper";
import { buildSiteUrl } from "@/lib/site-url";

function getCitationCount(item: Item | undefined) {
	if (!item) return 0;
	const relations = item.relations as RelationsType;
	if (!relations) return 0;
	
	const citedByCount = relations.cited_by || 0;
	const citedByArrayCount = Array.isArray(relations.citedBy) ? relations.citedBy.length : 0;
	
	return citedByCount + citedByArrayCount;
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

function ItemHeaderInstitution({ item }: { item: Item | undefined }) {
	if (!item?.institution?.length) return null;
	return (
		<Card className="p-1 px-3 text-sm bg-default-100 select-none">
			{formatInstitutions(item?.institution as string[])}
		</Card>
	);
}

function ItemHeaderInternal({ item }: { item: Item | undefined }) {
	const t = useTranslations("ui");
	if (!item?.tags?.includes(INTERNAL_TAG)) return null;
	return (
		<Card className="p-1 px-3 text-sm bg-default-100 select-none">
			{"Available on request"}
		</Card>
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

	const getUrl = useCallback(() => {
		if (typeof window === "undefined" || !item?.key) return "";
		return buildSiteUrl(`/lib/${item.key}`, window.location.origin);
	}, [item?.key]);

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
						onPressStart={handleBack}
						startContent={
							<IoChevronBack className="rtl:rotate-180" />
						}
						aria-label={t("itemBackAriaLabel")}
					>
						{t("itemBack")}
					</Button>
					<ItemHeaderInstitution item={item} />
					<ItemHeaderInternal item={item} />
					<div className="flex items-center gap-4 flex-wrap">
						<HeaderSection>
							<FaCalendar className="size-4" />
							{item?.year}
						</HeaderSection>

						<HeaderSection>
							<IoDocumentText className="size-4" />
							{item?.itemType ? tItemType(item?.itemType) : "-"}
						</HeaderSection>
					</div>
					<div className="ltr:ml-auto rtl:mr-auto flex flex-row-reverse items-center gap-2 flex-wrap">
						<DownloadButton
							size="sm"
							fileName={item?.key || ""}
							isIconOnly
							itemData={item}
							startContent={<LuDownload />}
							aria-label={t("itemDownloadAriaLabel")}
						/>
						<CopyButton textToCopy={getUrl()} label={t("copyLink")}>
							<Button
								size="sm"
								aria-label={t("itemCopyUrlAriaLabel")}
							>
								{t("copyLink")}
							</Button>
						</CopyButton>
						<LikeButton
							itemData={item}
							aria-label={t("itemLikeAriaLabel")}
						/>
						<AddButton
							itemData={item}
							aria-label={t("itemAddToCollectionAriaLabel")}
						/>
						<ZoteroDropdown
							item={item}
							aria-label={t("itemZoteroOptionsAriaLabel")}
						/>
						{!isLoading && (
							<AiWrapper data={{ item: item }} variant="inline" />
						)}
						{getCitationCount(item) > 0 && (
							item?.groupExternalId === 1 ? (
								<Button
									size="sm"
									color="secondary"
									startContent={<BsQuote className="size-4" />}
									className="pointer-events-none"
								>
									<span className="font-bold">{getCitationCount(item)}</span>
									<span className="opacity-80 font-normal">{t("itemCitationsCount")}</span>
								</Button>
							) : (
								<Button
									as={Link}
									href={isCitationPage ? `/lib/${item?.key}` : `/citation/${item?.key}`}
									prefetch={false}
									size="sm"
									color={isCitationPage ? "accent" : "secondary"}
									startContent={<BsQuote className="size-4" />}
									endContent={<IoChevronForward className={`size-3 opacity-50 ${isCitationPage ? "rotate-180" : ""}`} />}
								>
									<span className="font-bold">{getCitationCount(item)}</span>
									<span className="opacity-80 font-normal">{t("itemCitationsCount")}</span>
								</Button>
							)
						)}
					</div>
				</div>
			</Skeleton>
		</div>
	);
}
