"use client";

import useSWR from "swr";
import { ItemGetResponse } from "@/app/api/item/types";
import { fetcher } from "@/lib/utils";
import { displayColumns } from "@/db/schema/views/columns";
import { twMerge } from "tailwind-merge";
import { Skeleton } from "../nextui/Skeleton";
import { valueFormatter } from "@/lib/items";
import ItemRow from "@/components/features/items/ItemRow";
import ItemControls from "@/components/features/items/ItemControls";

export default function Item({ id }: { id: string }) {
	const { data, isLoading } = useSWR<ItemGetResponse>(`/item/${id}`, fetcher);

	return (
		<main className="w-full max-w-screen-2xl px-4 xl:px-14 flex flex-col gap-12 mt-4">
			<ItemControls />
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
						{
							data?.item && Object.keys(data.item).map((row: string) => (
								<ItemRow item={data.item} key={row} row={row} />
							))
						}
					</div>
				</Skeleton>
			</div>
		</main>
	);
}
