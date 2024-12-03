"use client";

import { ItemGetResponse } from "@/app/api/item/types";
import ItemRow from "@/components/features/items/ItemRow";
import ItemControls from "@/components/features/items/ItemControls";

export default function Item({ data }: { data: ItemGetResponse | undefined }) {
	return (
		<main className="w-full max-w-screen-2xl px-4 xl:px-14 flex flex-col gap-12 mt-4">
			<ItemControls />
			<div className="p-10 w-full dark:bg-card bg-white rounded-2xl dark:border dark:border-white/[8%] flex flex-col gap-8 ">
				{data?.item ? (
					<>
						<h1 className="text-4xl text-black/80 dark:text-white/80 font-medium">
							{data?.item.title}
						</h1>
						<div className="flex flex-col gap-8">
							{data?.item &&
								Object.keys(data.item).map((row: string) => (
									<ItemRow
										item={data.item!}
										key={row}
										row={row}
									/>
								))}
						</div>
					</>
				) : (
					<div className="text-center text-2xl text-black/80 dark:text-white/80 font-medium min-h-screen flex items-center justify-center">
						Item not found
					</div>
				)}
			</div>
		</main>
	);
}
