import { ReactNode, useRef, useMemo } from "react";
import { Item } from "@/app/api/item/types";
import { Collection } from "@/app/api/collections/types";
import { Button, CardBody, Link } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import Attachment from "@/components/features/items/Attachment";
import { createFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import CopyButton from "@/components/features/items/CopyButton";
import { Card } from "@/components/nextui/Card";
import { INSTITUTION_LOGOS } from "@/constants/items";
import { useFeatureFlagEnabled } from "@/context/Providers";

type FormatterProps = {
	value: any;
	item: Item;
	router: ReturnType<typeof useRouter>;
	formatter: ReturnType<typeof createFormatter>;
	t: ReturnType<typeof useTranslations>;
};

type Creator = {
	creatorType?: string;
	firstName?: string;
	lastName?: string;
	name?: string;
};

function formatDate({ value, formatter }: FormatterProps) {
	if (!value) return false;
	if (isNaN(new Date(value).getTime())) {
		return value};

	const date = new Date(value);
	const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;

	const returnedDate = formatter.dateTime(date, {
		year: "numeric",
		month: "long",
		day: "numeric",
...(hasTime && {
			hour: "numeric",
			minute: "numeric",
		}),
	});

	return returnedDate;
}

function Citation({ value }: FormatterProps) {
	const contentRef = useRef(null);
	return (
		<div className="flex gap-4 w-full bg-black/[4%] dark:bg-secondary-300 border border-white/[4%] p-4 rounded-2xl justify-between break-all">
			<div
				ref={contentRef}
				dangerouslySetInnerHTML={{ __html: value.trim() }}
			/>
			<CopyButton isIconOnly contentRef={contentRef} />
		</div>
	);
}

function Extra({ value }: { value: string }) {
	const DOIRegex = /10\.\d{4,9}\/[-._;()/:\w-]+/gi;
	const DOIs = useMemo(() => Array.from(value.matchAll(DOIRegex)), [value]);

	const elements = useMemo(() => {
		if (!DOIs.length) return [value];

		let lastIndex = 0;
		const elements = [];

		DOIs.forEach((match, i) => {
			const doi = match[0];
			const startIndex = match.index!;

			if (startIndex > lastIndex) {
				elements.push(value.slice(lastIndex, startIndex));
			}

			elements.push(
				<Link
					key={i}
					href={`https://doi.org/${doi}`}
					className="text-accent"
					showAnchorIcon
				>
					{doi}
				</Link>
			);

			lastIndex = startIndex + doi.length;
		});

		if (lastIndex < value.length) {
			elements.push(value.slice(lastIndex));
		}

		return elements;
	}, [DOIs, value]);

	return <>{elements}</>;
}

function Collections({ value }: { value: Collection[] }) {
	const isCollectionsEnabled = useFeatureFlagEnabled("collections");
	
	if (!isCollectionsEnabled) return false;
	if (!value) return false;
	if (value.length === 0) return false;

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
	collectionsAncestry: () => false,
	fullNames: () => false,
	itemType: ({ value, t }) => t("itemType." + value),
	collections: () => false,
	title: () => false,
	creators: ({ value, t }) => {
		if (!value) return null;
		if (value.length === 0) return null;
		return (
			<ul className="flex flex-col xl:gap-2">
				{value.map((creator: Creator, index: number) => {
					const creatorTypeLabel = t(
						"creatorType." + creator.creatorType
					);
					return (
						<li
							className="flex gap-2 rtl:flex-row-reverse max-w-fit"
							key={index}
						>
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
	collectionsData: Collections,
	date: formatDate,
	accessDate: formatDate,
	url: ({ value }) => (
		<Link href={value} className="text-accent break-all" showAnchorIcon>
			{value}
		</Link>
	),
	attachmentsData: ({ value }) => {
		const filteredValue = value.filter(
			(data: any) => data.PDFCoverPageImage
		);

		if (filteredValue.length === 0) return false;

		return (
			<div className="flex flex-col gap-2 xl:w-2/3 w-full">
				{value
					.filter((data: any) => data.PDFCoverPageImage)
					.map((data: Item, index: number) => (
						<Attachment data={data} key={index} />
					))}
			</div>
		);
	},
	extra: (args) => {
		const finalValue = args.value;

		return (
			<div className="whitespace-pre-line">
				<Extra {...args} value={finalValue} />
			</div>
		);
	},
	citation: (args) => {
		if (!args.value) return false;
		return <Citation {...args} />;
	},
	institution: ({ value }) => {
		if (!value) return false;

		const InstitutionLogo = Object.entries(INSTITUTION_LOGOS).find(
			([key]) => value.includes(key)
		)?.[1];

		return (
			<div>
				<Card className="max-w-fit p-2 rounded-2xl" color="accent">
					<div className={twMerge("flex gap-2 items-center", !InstitutionLogo && "px-2")}>
						{InstitutionLogo && (
							<InstitutionLogo className="bg-white/80" />
						)}
						<h3 className="text-black/80 dark:text-white/80">
							{value}
						</h3>
					</div>
				</Card>
			</div>
		);
	},
};
