"use client";

import { RelationsType } from "@/types/item";
import useSWR from "swr";
import { fetcher } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { MdSearchOff } from "react-icons/md";
import { ItemGetResponse } from "@/app/api/item/types";
import Resource from "../items/Resource";
import { useTranslations } from "next-intl";

function Relation({ value }: { value: string }) {
	const keyFromValue = value.split("/").pop() || "";

	const { data: fetchedItemData, isLoading: fetchedItemDataLoading } =
		useSWR<ItemGetResponse>(
			keyFromValue ? `/item/${keyFromValue}` : null,
			fetcher,
			{
				revalidateOnFocus: false,
				revalidateIfStale: false,
				revalidateOnReconnect: false,
				shouldRetryOnError: false,
			}
		);

	const hasData = !(!fetchedItemData?.item && !fetchedItemDataLoading);

	return (
		<AnimatePresence>
			{hasData && (
				<motion.li
					initial={{ opacity: 0 }}
					animate={{
						opacity: 1,
					}}
					exit={{ opacity: 0 }}
					transition={{ duration: 0.3 }}
					key={keyFromValue}
					layout
				>
					<Resource
						as="div"
						itemData={fetchedItemData?.item}
						isLoading={fetchedItemDataLoading}
						abstract={false}
						className="h-full"
						hideUnapi={true}
					/>
				</motion.li>
			)}
		</AnimatePresence>
	);
}


export default function Relations({ value }: { value: RelationsType }) {
	const t = useTranslations("ui");
	const obj = (value as RelationsType) || {};
	const relationsObject = {
		"dc:relation": obj["dc:relation"] || [],
		"owl:sameAs": obj["owl:sameAs"] || [],
		related_works: obj["related_works"] || [],
	};
	return (
		<div>
			<ul className="flex flex-col md:grid grid-cols-2 gap-4">
				<AnimatePresence mode="popLayout">
					{Object.entries(relationsObject).map(
						([key, value], index) => {
							const valueArray = Array.isArray(value)
								? value
								: [value];
							return valueArray.map((v, i) => (
								<Relation key={key + "-" + i} value={v} />
							));
						}
					)}
				</AnimatePresence>
				<div className="first:block hidden">
					<div className="flex gap-2 ">
						<MdSearchOff className="size-6" />
						{t("noRelationsFound")}
					</div>
				</div>
			</ul>
		</div>
	);
}