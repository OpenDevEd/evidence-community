import { ReactNode } from "react";
import { Item } from "@/app/api/item/types";
import { creatorTypeLabels } from "@/db/schema/enums/creatorType";
import { Collection } from "@/app/api/collections/types";
import { Link } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import { itemTypeLabels } from "@/db/schema/enums/itemType";
import { Creator } from "@/db/schema/tables/item";
import Attachment from "@/components/features/items/Attachment";

function formatDate(value: string) {
	if (!value) return false;
	if (isNaN(new Date(value).getTime())) return false;
	return new Date(value).toLocaleDateString("en-GB", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

export const valueFormatter: Record<
	any,
	(value: any, item?: Item) => ReactNode | boolean
> = {
	id: () => false,
	version: () => false,
	key: (value) => false,
	updatedAt: () => false,
	createdAt: () => false,
	tags: () => false,
	groupExternalId: () => false,
	dateAdded: () => false,
	dateModified: () => false,
	relations: () => false,
	deleted: () => false,
	year: () => false,
	fullNames: () => false,
	itemType: (value) => itemTypeLabels[value as keyof typeof itemTypeLabels]!,
	collections: () => false,
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
	collectionsData: (value) => {
		if (!value) return null;
		if (value.length === 0) return null;

		value.sort(
			(a: Collection, b: Collection) =>
				a.title?.localeCompare(b.title || "") || 0
		);

		return (
			<ul className="flex flex-col gap-2">
				{value.map((collection: Collection) => {
					const ancestry = collection.ancestry || [];
					return (
						<li key={collection.id}>
							<Link
								showAnchorIcon
								href={`/lib?collections=${[
									...ancestry,
									collection.key,
								].join(",")}`}
								className="text-tertiary-400"
							>
								<span className="text-black/60 dark:text-white/60 underline">
									{collection.title} / {collection.name}
								</span>
							</Link>
						</li>
					);
				})}
			</ul>
		);
	},
	date: formatDate,
	accessDate: formatDate,
	url: (value) => (
		<Link href={value} className="text-accent break-all" showAnchorIcon>
			{value}
		</Link>
	),
	attachmentsData: (value) => {
		const filteredValue = value.filter(
			(data: any) => data.PDFCoverPageImage
		);
		if (filteredValue.length === 0) return false;

		return (
			<div className="flex flex-col gap-2 w-2/3">
				{value
					.filter((data: any) => data.PDFCoverPageImage)
					.map((data: Item, index: number) => (
						<Attachment data={data} key={index} />
					))}
			</div>
		);
	},
};

