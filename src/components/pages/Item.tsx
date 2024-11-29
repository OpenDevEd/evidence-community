"use client";

import useSWR from "swr";
import { ItemGetResponse } from "@/app/api/item/types";
import { fetcher } from "@/lib/fetcher";
import { columnLabels, displayColumns } from "@/db/schema/views/columns";
import type { Item } from "@/app/api/item/types";
import { ReactNode } from "react";
import { itemTypeLabels } from "@/db/schema/enums/itemType";
import { twMerge } from "tailwind-merge";
import { LuChevronLeft, LuDownload, LuPrinter } from "react-icons/lu";
import { useRouter } from "next/navigation";
import { Button } from "../nextui/Button";
import { TiDocumentText } from "react-icons/ti";
import { PiSlidersHorizontalBold } from "react-icons/pi";
import { Creator } from "@/db/schema/tables/item";
import { creatorType, creatorTypeLabels } from "@/db/schema/enums/creatorType";
import { Skeleton } from "../nextui/Skeleton";
import { Collection } from "@/app/api/collections/types";
import { Link } from "@nextui-org/react";

const valueFormatter: Record<
	any,
	(value: any, item?: Item) => ReactNode | boolean
> = {
	id: () => false,
	version: () => false,
	key: (value) => false,
	itemType: (value) => itemTypeLabels[value as keyof typeof itemTypeLabels]!,
	creators: (value) => {
		if (!value) return null;
		if (value.length === 0) return null;
		return (
			<ul className="flex flex-col gap-2">
				{value.map((creator: Creator, index: number) => {
					const creatorTypeLabel =
						creatorTypeLabels[
							creator.creatorType as keyof typeof creatorTypeLabels
						];
					return (
						<li className="flex gap-2" key={index}>
							<span className="font-medium text-accent">
								{creator.firstName
									? `${creator.firstName}, ${creator.lastName}`
									: creator.name}
							</span>
							<span
								className={twMerge(
									"text-black/80 dark:text-white/80 capitalize",
									!creatorTypeLabel && "!text-red-500"
								)}
							>
								({creatorTypeLabel || creator.creatorType})
							</span>
						</li>
					);
				})}
			</ul>
		);
	},
	title: (value) => value,
	accessDate: (value) => value,
	language: (value, item) => item?.languageName,
	collectionsData: (value) => {
		if (!value) return null;
		if (value.length === 0) return null;

		return (
			<ul className="flex flex-col gap-2">
				{value.map((collection: Collection) => {
					const ancestry = collection.ancestry || []
					return (
						<li key={collection.id}>
							<Link
								showAnchorIcon
								href={`/?collections=${[...ancestry, collection.key].join(",")}`}
								className="text-tertiary-400"
							>
								<span className="text-black/60 dark:text-white/60 underline">
									{collection.name}
								</span>
							</Link>
						</li>
					);
				})}
			</ul>
		);
	},
};

function Row({ item, row }: { item: Item; row: string }) {
	const rowName = columnLabels[row as keyof typeof columnLabels];
	const rowValue = valueFormatter[row]
		? valueFormatter[row]!(item[row as keyof Item], item)
		: String(item[row as keyof Item]);

	if (!rowValue) return null;

	return (
		<div className="flex">
			<h3
				className={twMerge(
					"text-xl font-medium text-black/60 dark:text-white/60 xl:w-64 w-24 shrink-0 rounded",
					!rowName && "!text-red-500",
					rowValue === undefined && "bg-red-500 text-center"
				)}
			>
				{rowName || row}:
			</h3>
			<div className="text-lg text-black/80 dark:text-white/80 font-medium overflow-hidden break-words">
				{rowValue}
			</div>
		</div>
	);
}

export default function Item({ id }: { id: string }) {
	const { data, isLoading } = useSWR<ItemGetResponse>(`/item/${id}`, fetcher);

	const router = useRouter();

	return (
		<main className="w-full max-w-screen-2xl px-4 xl:px-14 flex flex-col gap-12 mt-4">
			<div className="flex justify-start gap-6 w-full">
				<Button
					startContent={<LuChevronLeft className="size-5" />}
					onClick={() => router.back()}
				>
					Return
				</Button>
				<Button
					className="ml-auto"
					startContent={<TiDocumentText className="size-5" />}
				>
					Read Document
				</Button>
				<Button startContent={<LuDownload className="size-5" />}>
					Download This Record
				</Button>
				<Button startContent={<LuPrinter className="size-5" />}>
					Print This Record
				</Button>
				<Button
					startContent={
						<PiSlidersHorizontalBold className="size-5" />
					}
				>
					Preferences
				</Button>
			</div>
			<div className="p-10 w-full dark:bg-card bg-white rounded-2xl dark:border dark:border-white/[8%] flex flex-col gap-8 ">
				<Skeleton
					className={twMerge(
						"w-full min-h-10 rounded-2xl",
						!isLoading && "min-h-0"
					)}
					isLoaded={!isLoading}
				>
					<h1 className="text-4xl text-black/80 dark:text-white/80 font-medium">
						{data?.item.title}
					</h1>
				</Skeleton>
				<Skeleton
					className={twMerge(
						"w-full min-h-screen rounded-2xl",
						!isLoading && "min-h-0"
					)}
					isLoaded={!isLoading}
				>
					<div className="flex flex-col gap-8">
						{data?.item &&
							Object.keys(valueFormatter).map((row: string) => (
								<Row item={data.item} key={row} row={row} />
							))}
						{data?.item &&
							displayColumns[data.item.itemType]
								.filter((row: string) => !valueFormatter[row])
								.map((row: string) => (
									<Row item={data.item} key={row} row={row} />
								))}
					</div>
				</Skeleton>
			</div>
		</main>
	);
}
