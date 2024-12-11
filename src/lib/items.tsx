import { ReactNode } from "react";
import { Item } from "@/app/api/item/types";
import { Collection } from "@/app/api/collections/types";
import { Link } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import { Creator } from "@/db/schema/tables/item";
import Attachment from "@/components/features/items/Attachment";
import { createFormatter, useTranslations } from "next-intl";

type FormatterProps = {
	value: any;
	item: Item;
	formatter: ReturnType<typeof createFormatter>;
	t: ReturnType<typeof useTranslations>;
};

function formatDate({
	value,
	formatter,
}: FormatterProps) {
	if (!value) return false;
	if (isNaN(new Date(value).getTime())) return value;
	return formatter.dateTime(new Date(value), {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

export const valueFormatter: Record<
	any,
	(props: FormatterProps) => ReactNode | boolean
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
	itemType: ({value, t}) => t("itemType." + value),
	collections: () => false,
	title: () => false,
	creators: ({value, t}) => {
		if (!value) return null;
		if (value.length === 0) return null;
		return (
			<ul className="flex flex-col gap-2">
				{value.map((creator: Creator, index: number) => {
					const creatorTypeLabel = t("creatorType." + creator.creatorType);
					return (
						<li className="flex gap-2 rtl:flex-row-reverse max-w-fit" key={index}>
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
	collectionsData: ({value}) => {
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
	url: ({value}) => (
		<Link href={value} className="text-accent break-all" showAnchorIcon>
			{value}
		</Link>
	),
	attachmentsData: ({value}) => {
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

