import { ReactNode, useRef, useMemo, memo } from "react";
import { Item } from "@/app/api/item/types";
import { Collection } from "@/app/api/collections/types";
import { Button, CardBody, Divider, Link } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import Attachment from "@/components/features/items/Attachment";
import { createFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import CopyButton from "@/components/features/items/CopyButton";
import { Card } from "@/components/nextui/Card";
import { INSTITUTION_LOGOS } from "@/constants/items";
import { useFeatureFlagEnabled } from "@/context/Providers";
import { getExtraValues } from "./utils";
import { buildHierarchy } from "./collections";
import { Skeleton } from "@/components/nextui/Skeleton";

type FormatterProps = {
	value: any;
	item: Item;
	router: ReturnType<typeof useRouter>;
	formatter: ReturnType<typeof createFormatter>;
	t: ReturnType<typeof useTranslations>;
	loading: boolean;
};

type Creator = {
	creatorType?: string;
	firstName?: string;
	lastName?: string;
	name?: string;
};

type MatchWrapperProps = {
	match: string;
	index: number;
	href?: string;
};

type WrapperConfig = {
	regex: RegExp;
	Wrapper: React.ComponentType<MatchWrapperProps>;
	priority?: number;
};

function formatDate({ value, formatter }: FormatterProps) {
	if (!value) return false;
	if (isNaN(new Date(value).getTime())) {
		return value;
	}

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

function Citation({ value, loading }: FormatterProps) {
	const contentRef = useRef(null);
	return (
		<Skeleton isLoaded={true} className="w-fit h-fit rounded-2xl">
			<div className="flex gap-4 w-full bg-black/[4%] dark:bg-secondary-300 border border-white/[4%] p-4 rounded-2xl justify-between break-all">
				<div
					ref={contentRef}
					dangerouslySetInnerHTML={{ __html: value.trim() }}
				/>
				<CopyButton isIconOnly contentRef={contentRef} />
			</div>
		</Skeleton>
	);
}

function createRegexParser(wrappers: WrapperConfig[]) {
	const sortedWrappers = [...wrappers].sort(
		(a, b) => (b.priority ?? 0) - (a.priority ?? 0)
	);

	return memo(function RegexParser({ value }: { value: string }) {
		const allMatches = useMemo(() => {
			if (!value) return [];

			const matchMap = new Map<
				number,
				{
					match: RegExpMatchArray;
					Wrapper: React.ComponentType<MatchWrapperProps>;
					start: number;
					end: number;
					priority: number;
				}
			>();

			sortedWrappers.forEach(({ regex, Wrapper }, priority) => {
				Array.from(value.matchAll(regex)).forEach((match) => {
					const start = match.index!;
					const end = start + match[0].length;

					let hasOverlap = false;
					matchMap.forEach((existing) => {
						if (
							start < existing.end &&
							end > existing.start &&
							priority >= existing.priority
						) {
							hasOverlap = true;
						}
					});

					if (!hasOverlap) {
						matchMap.set(start, {
							match,
							Wrapper,
							start,
							end,
							priority,
						});
					}
				});
			});

			return Array.from(matchMap.values()).sort(
				(a, b) => a.start - b.start
			);
		}, [value]);

		const elements = useMemo(() => {
			if (!allMatches.length) return [value];

			const result: Array<string | ReactNode> = [];
			let lastIndex = 0;

			allMatches.forEach(({ match, Wrapper, start, end }, idx) => {
				if (start > lastIndex) {
					result.push(value.slice(lastIndex, start));
				}

				result.push(
					<Wrapper
						key={`${match[0]}-${idx}`}
						match={match[0]}
						index={idx}
					/>
				);

				lastIndex = end;
			});

			if (lastIndex < value.length) {
				result.push(value.slice(lastIndex));
			}

			return result;
		}, [allMatches, value]);

		return <>{elements}</>;
	});
}

const DOIWrapper = ({ match, index }: MatchWrapperProps) => (
	<Link
		key={index}
		href={`https://doi.org/${match}`}
		className="dark:text-doi text-doi_light text-lg"
		showAnchorIcon
	>
		{match}
	</Link>
);

const URLWrapper = ({ match, index }: MatchWrapperProps) => (
	<Link
		key={index}
		href={match}
		className="dark:text-link text-link_light text-lg"
		showAnchorIcon
	>
		{match}
	</Link>
);

const urlRegex = /https?:\/\/[^\s]+/gi;
const doiRegex = /10\.\d{4,9}\/[-._;()/:\w-]+/gi;

const Extra = createRegexParser([
	{ regex: doiRegex, Wrapper: DOIWrapper, priority: 1 },
	{ regex: urlRegex, Wrapper: URLWrapper, priority: 2 },
]);

function CollectionLevel({ collection }: { collection: Collection }) {
	const ancestry = collection.ancestry || [];
	const href = `/lib?collections=${[...ancestry, collection.key].join(",")}`;

	return (
		<div className="flex flex-col">
			<Link
				showAnchorIcon
				href={href}
				className="dark:text-collection text-collection_light text-lg"
				underline="hover"
			>
				<span className="dark:text-collection text-collection_light">
					{collection.name}
				</span>
			</Link>
			<div className="ml-8">
				{collection.children?.map((child) => (
					<CollectionLevel key={child.id} collection={child} />
				))}
			</div>
		</div>
	);
}

export function CollectionsRow({ value }: { value: Collection[] }) {
	if (!value) return false;
	if (value.length === 0) return false;

	return (
		<ul className="flex flex-col gap-2">
			{value.map((collection: Collection) => (
				<CollectionLevel key={collection.id} collection={collection} />
			))}
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
	fullTextPDFs: () => false,
	dateModified: () => false,
	relations: () => false,
	deleted: () => false,
	year: () => false,
	collectionsAncestry: () => false,
	fullNames: () => false,
	itemType: ({ value, t }) => t("itemType." + value),
	collections: () => false,
	title: () => false,
	note: ({ value }) => (
		<div
			dangerouslySetInnerHTML={{ __html: value }}
			className="text-lg text-black/80 dark:text-white/80 font-medium break-words w-full"
		/>
	),
	DOI: ({ value }) => <Extra value={value} />,
	creators: ({ value, t }) => {
		if (!value) return null;
		if (value.length === 0) return null;

		return (
			<ul className="flex flex-col xl:gap-2">
				{value.map((creator: Creator, index: number) => {
					const creatorTypeLabel = t(
						"creatorType." + creator.creatorType
					);
					const { creatorType, ...rest } = creator;
					return (
						<li
							className="flex gap-2 rtl:flex-row-reverse max-w-fit"
							key={index}
						>
							<span className="font-medium text-accent">
								{Object.values(rest).filter(Boolean).join(", ")}
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
	collectionsData: () => false,
	date: formatDate,
	accessDate: formatDate,
	url: ({ value }) => (
		<Link
			href={value}
			className="dark:text-link text-link_light break-all text-lg"
			showAnchorIcon
		>
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
		const values = getExtraValues(finalValue);
		const filteredValues = Array.from(values.entries());

		if (filteredValues.length === 0) return false;

		return (
			<div className="whitespace-pre-line space-y-2 bg-black/[4%] dark:bg-secondary-300 border border-white/[4%] p-4 rounded-2xl">
				{filteredValues.map(([key, value], index) => {
					const formattedValue = formatDate({ ...args, value });
					return (
						<div key={index} className="flex flex-col gap-2 group">
							<div className="break-all">
								<CopyButton
									text={key}
									content={formattedValue}
									className="inline-flex ltr:mr-2 rtl:ml-2"
								/>
								<span>
									<Extra value={value} />
								</span>
							</div>
							<Divider className="my-2 group-last:hidden" />
						</div>
					);
				})}
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
					<div
						className={twMerge(
							"flex gap-2 items-center",
							!InstitutionLogo && "px-2"
						)}
					>
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
