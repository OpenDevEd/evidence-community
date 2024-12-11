import { twMerge } from "tailwind-merge";
import { Item } from "@/app/api/item/types";
import { firstNonNullOrEmpty } from "@/lib/utils";
import { Skeleton } from "@/components/nextui/Skeleton";
import { Link as NextUILink } from "@nextui-org/react";
import ResourceAuthors from "./ResourceAuthors";
import ResourceDivider from "./ResourceDivider";
import ResourceData from "./ResourceData";
import { useRouter } from "@/i18n/routing";
import { useFormatter, useTranslations } from "next-intl";

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
		<div
			onClick={() => router.push(`/lib/${itemData?.key}`)}
			className="w-full bg-white dark:bg-white/[4%] rounded-xl p-4 xl:p-6 flex flex-col gap-4 cursor-pointer hover:brightness-90 transition-all"
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
			<Skeleton
				isLoaded={!isLoading}
				className="w-full xl:w-1/2 rounded-2xl"
			>
				<NextUILink
					showAnchorIcon
					href="/"
					className="font-medium text-tertiary-400"
				>
					<span className="text-black/60 dark:text-white/60 ">
						{t("viewOnDocs", { site: "docs.opendeved.net" })}
					</span>
				</NextUILink>
			</Skeleton>
		</div>
	);
}
