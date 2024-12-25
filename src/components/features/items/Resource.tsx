import { twMerge } from "tailwind-merge";
import { Item } from "@/app/api/item/types";
import { firstNonNullOrEmpty } from "@/lib/utils";
import { Skeleton } from "@/components/nextui/Skeleton";
import { Link as NextUILink } from "@nextui-org/react";
import ResourceAuthors from "./ResourceAuthors";
import ResourceDivider from "./ResourceDivider";
import ResourceData from "./ResourceData";
import { Link, useRouter } from "@/i18n/routing";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/nextui/Button";
import { FaClipboard, FaClipboardCheck } from "react-icons/fa";
import { useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import CopyButton from "./CopyButton";


function ResourceInteractions({
	itemData,
	isLoading,
}: {
	itemData: Item | undefined;
	isLoading: boolean;
}) {
	const t = useTranslations("ui");

	return (
		<div className="p-2 bg-black/[4%] dark:bg-secondary rounded-b-xl shrink-0">
			<Skeleton isLoaded={!isLoading} className="w-full rounded-2xl">
				<div className="w-full rounded-2xl flex flex-row items-center">
					<NextUILink
						showAnchorIcon
						href="/"
						className="font-medium text-tertiary-400 shrink-1 px-2"
					>
						<span className="text-black/60 dark:text-white/60 ">
							{t("viewOnDocs", {
								site: "docs.opendeved.net",
							})}
						</span>
					</NextUILink>
					<div className="flex-1 flex items-center justify-end z-10">
						<CopyButton shrinkOnMobile itemData={itemData} text={t("copyLink")} textOnCopy={t("linkCopied")} />
					</div>
				</div>
			</Skeleton>
		</div>
	);
}

export default function Resource({
	itemData,
	abstract,
	isLoading,
}: {
	itemData: Item | undefined;
	abstract: boolean;
	isLoading: boolean;
}) {
	const t = useTranslations("ui");
	const format = useFormatter();

	const abstractText =
		itemData && firstNonNullOrEmpty(itemData, ["abstractNote"]);

	const router = useRouter();

	return (
		<div className="w-full bg-white dark:bg-white/[4%] rounded-xl flex flex-col">
			<Link
				href={`/lib/${itemData?.key}`}
				className="p-4 xl:p-6 flex flex-col gap-4 hover:brightness-90 transition-all flex-1"
			>
				<Skeleton
					isLoaded={!isLoading}
					className="w-full min-h-8 rounded-2xl"
				>
					<h1 className="capitalize text-2xl text-black/80 dark:text-white/80 line-clamp-2">
						{itemData?.title}
					</h1>
				</Skeleton>
				<Skeleton
					isLoaded={!isLoading}
					className="w-full min-h-8 rounded-2xl"
				>
					<div className="flex w-full gap-2 items-center flex-wrap">
						<ResourceAuthors itemData={itemData} />
						<ResourceDivider />
						{itemData?.date &&
							!isNaN(new Date(itemData.date).getTime()) && (
								<>
									<ResourceData
										text={format.dateTime(
											new Date(itemData.date),
											{
												dateStyle: "medium",
											}
										)}
										classNames={{
											text: "text-black/60 dark:text-white/60 font-normal",
										}}
									/>
									<ResourceDivider />
								</>
							)}

						{itemData?.tags?.includes("_comingsoon") && (
							<div className="bg-accent rounded-lg px-4 py-1 text-white/80 font-medium w-full xl:w-auto text-center">
								{t("inProgress")}
							</div>
						)}
					</div>
				</Skeleton>
				{abstract && (abstractText || !itemData) && (
					<Skeleton
						isLoaded={!isLoading}
						className={twMerge(
							"w-full min-h-0 rounded-2xl ",
							!itemData ? "min-h-20" : "min-h-0"
						)}
					>
						<p className="text-black/60 dark:text-white/60 line-clamp-3 text-lg w-full break-all">
							{abstractText}
						</p>
					</Skeleton>
				)}
			</Link>
			<ResourceInteractions itemData={itemData} isLoading={isLoading} />
		</div>
	);
}
