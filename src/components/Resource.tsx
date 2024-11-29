import { twMerge } from "tailwind-merge";
import { Item } from "@/app/api/item/types";
import { firstNonNullOrEmpty } from "@/lib/lib";
import { Skeleton } from "@/components/nextui/Skeleton";
import { Link as NextUILink } from "@nextui-org/react";
import { useRouter } from "next/navigation";
import { INSTITUTION_LOGOS } from "@/constants/institutions";

function ResourceAuthors({ itemData }: { itemData: Item | undefined }) {
	if (itemData?.institution) {
		const institutionLogo = Object.entries(INSTITUTION_LOGOS).find(
			([key]) => itemData.institution?.includes(key)
		)?.[1];

		return (
			<ResourceData
				startContent={institutionLogo}
				text={itemData?.institution}
			/>
		);
	}

	if (itemData && itemData.creators && itemData.creators.length > 0)
		return (
			<div className="max-w-64 truncate overflow-hidden">
				{itemData?.creators
					?.map((creator: any) =>
						creator.firstName
							? `${creator.firstName}, ${creator.lastName}`
							: creator.name || null
					)
					.join(", ")}
			</div>
		);

	return null;
}

function ResourceDivider() {
	return (
		<div className="text-black/80 dark:text-white/60 first:hidden last:hidden">
			|
		</div>
	);
}

function ResourceData({
	startContent,
	classNames,
	text,
}: {
	startContent?: React.ReactNode;
	classNames?: {
		container?: string;
		text?: string;
	};
	text: string | null;
}) {
	return (
		<div
			className={twMerge(
				"flex gap-2 items-center",
				classNames?.container
			)}
		>
			{startContent}
			<span
				className={twMerge(
					"text-black/60 dark:text-white/60 font-medium text-lg line-clamp-1",
					classNames?.text,
					!text && "!w-24"
				)}
			>
				{text}
			</span>
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
	const abstractText =
		itemData && firstNonNullOrEmpty(itemData, ["abstractNote"]);

	const router = useRouter();

	return (
		<div
			onClick={() => router.push(`/item/${itemData?.key}`)}
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
					<ResourceData
						text={
							itemData && itemData.dateAdded
								? new Date(
										itemData.dateAdded
								  ).toLocaleDateString("en-US", {
										dateStyle: "medium",
								  })
								: null
						}
						classNames={{
							text: "text-black/60 dark:text-white/60 font-normal",
						}}
					/>
					<ResourceDivider />
					{itemData?.collections?.includes("_comingsoon") && (
						<div className="bg-accent rounded-lg px-4 py-1 text-white/80 font-medium w-full xl:w-auto text-center">
							In Progress
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
						view on docs.opendeved.net
					</span>
				</NextUILink>
			</Skeleton>
		</div>
	);
}
