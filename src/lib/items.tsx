import { CitationPanel } from "@/components/features/items/CitationControl";
import { canCiteItem } from "@/lib/citation-formats";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { SearchRemoveIcon } from "@hugeicons/core-free-icons";
import { ReactNode, useMemo, memo, useState, useEffect } from "react";
import { normalizeAccessDate } from "@/lib/admin/field-contract";
import { Item, ItemGetResponse } from "@/app/api/item/types";
import { Collection } from "@/app/api/collections/types";
import { Accordion, AccordionItem, Divider, Link } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import Attachment from "@/components/features/items/Attachment";
import { createFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import CopyButton from "@/components/features/items/CopyButton";
import { Card } from "@/components/nextui/Card";
import { InstitutionLogo } from "@/components/library/LibraryIdentity";
import { findInstitutionWithLogo } from "@/config/library-config/institutions";
import {
	useLibraryConfig,
	useLibraryFeature,
} from "@/context/LibraryConfigProvider";
import { fetcher, getCountryAncestry, getExtraValues } from "./utils";
import { Skeleton } from "@/components/nextui/Skeleton";
import LinkWithParams from "@/components/features/LinkWithParams";
import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { RelationsType } from "@/types/item";
import Resource from "@/components/features/items/Resource";
import useSWR from "swr";
import { serializeSearchParams } from "./searchParams";
import { COUNTRY_PARAMS } from "@/constants/misc";

type FormatterProps = {
	value: any;
	item: Item;
	router: ReturnType<typeof useRouter>;
	formatter: ReturnType<typeof createFormatter>;
	t: ReturnType<typeof useTranslations>;
	loading: boolean;
	pathname: string;
};

type Creator = {
	creatorType?: string;
	firstName?: string;
	lastName?: string;
	name?: string;
	institutions?: { id: string; display_name: string; country_code: string }[];
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
	});

	return <p>{returnedDate}</p>;
}

// Access dates are calendar dates. Old records may still hold text such as
// CURRENT_TIMESTAMP (issue #103); a visitor must never see that, so anything
// the admin rule does not accept as a date is hidden instead of printed.
function formatAccessDate(props: FormatterProps) {
	if (typeof props.value !== "string" || !normalizeAccessDate(props.value)) {
		return false;
	}
	return formatDate(props);
}

function Citation({ item }: FormatterProps) {
	return canCiteItem(item) ? <CitationPanel item={item} completeRecord /> : null;
}

function createRegexParser(wrappers: WrapperConfig[], tag: string = "p") {
	const sortedWrappers = [...wrappers].sort(
		(a, b) => (b.priority ?? 0) - (a.priority ?? 0),
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
				(a, b) => a.start - b.start,
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
					/>,
				);

				lastIndex = end;
			});

			if (lastIndex < value.length) {
				result.push(value.slice(lastIndex));
			}

			return result;
		}, [allMatches, value]);

		return !tag ? <>{elements}</> : React.createElement(tag, {}, elements);
	});
}

const DOIWrapper = ({ match, index }: MatchWrapperProps) => (
	<Link
		key={index}
		href={`https://doi.org/${match}`}
		underline="always"
		className="text-doi text-lg"
		showAnchorIcon
	>
		{match}
	</Link>
);

const URLWrapper = ({ match, index }: MatchWrapperProps) => (
	<Link
		key={index}
		href={match}
		underline="always"
		className="text-link text-lg"
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

function CollectionLevel({
	collection,
	pathname,
}: {
	collection: Collection;
	pathname: string;
}) {
	const ancestry = collection.ancestry || [];
	const href = serializeSearchParams(pathname, {
		collections: [...ancestry, collection.key],
	});

	return (
		<li className="flex flex-col">
			<Link
				showAnchorIcon
				href={href}
				className="text-collection text-lg"
				underline="always"
			>
				<span className="text-collection">{collection.name}</span>
			</Link>
			<ul className="ml-8">
				{collection.children?.map((child) => (
					<CollectionLevel
						key={child.key}
						collection={child}
						pathname={pathname}
					/>
				))}
			</ul>
		</li>
	);
}

export function CollectionsRow({
	value,
	pathname,
}: {
	value: Collection[];
	pathname: string;
}) {
	if (!value) return false;
	if (value.length === 0) return false;

	return (
		<ul className="flex flex-col gap-2">
			{value.map((collection: Collection) => (
				<CollectionLevel
					key={collection.key}
					collection={collection}
					pathname={pathname}
				/>
			))}
		</ul>
	);
}

function ObjectView({
	value,
	args,
}: {
	value: Map<string, any> | Record<string, any>;
	args: FormatterProps;
}) {
	if (!(value instanceof Map)) {
		value = new Map(
			Object.entries(value).map(([key, value]) => [key, String(value)]),
		);
	}

	const filteredValues: [string, string][] = Array.from(value.entries());

	const ExtraSpan = createRegexParser(
		[
			{ regex: doiRegex, Wrapper: DOIWrapper, priority: 1 },
			{ regex: urlRegex, Wrapper: URLWrapper, priority: 2 },
		],
		"span",
	);

	if (filteredValues.length === 0) return false;

	return (
		<ul className="whitespace-pre-line space-y-2 bg-black/[4%] dark:bg-secondary-300 border border-white/[4%] p-4 rounded-2xl">
			{filteredValues.map(([key, value], index) => {
				const formattedValue = formatDate({ ...args, value });
				return (
					<li key={index} className="flex flex-col gap-2 group">
						<div className="break-all flex gap-4">
							<p className="flex-1">
								<strong className="text-black/60 dark:text-white/60">
									{key}
								</strong>
								<span className="whitespace-pre"> </span>
								<ExtraSpan value={value} />
							</p>
							<CopyButton
								isIconOnly
								content={formattedValue}
								className="shrink-0"
							/>
						</div>
						<Divider className="my-2 group-last:hidden" />
					</li>
				);
			})}
		</ul>
	);
}

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
			},
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
					/>
				</motion.li>
			)}
		</AnimatePresence>
	);
}

function Relations({ value }: { value: RelationsType }) {
	const obj = (value as RelationsType) || {};
	// if (!obj) return false;
	const relationsObject = {
		"dc:relation": obj["dc:relation"] || [],
		"owl:sameAs": obj["owl:sameAs"] || [],
		related_works: obj["related_works"] || [],
	};
	return (
		<div className="">
			<ul className="flex flex-col gap-4">
				<AnimatePresence mode="popLayout">
					{Object.entries(relationsObject).map(
						([key, value], index) => {
							const valueArray = Array.isArray(value)
								? value
								: [value];
							return valueArray.map((v, i) => (
								<Relation key={key + "-" + i} value={v} />
							));
						},
					)}
				</AnimatePresence>
				<div className="first:block hidden">
					<div className="flex justify-center items-center gap-2 ">
						<HugeiconsIcon
							icon={SearchRemoveIcon}
							className="size-6"
						/>
						There are no relations found for this item in this
						database.
					</div>
				</div>
			</ul>
		</div>
	);
}

function ItemCountry({
	value,
	pathname,
}: {
	value: string | string[];
	pathname: string;
}) {
	const isCountryFocusEnabled = useLibraryFeature("countryFocus");

	if (!isCountryFocusEnabled) return false;

	if (!value) return false;

	const countries = Array.isArray(value) ? value : [value];

	if (countries.length === 0) return false;

	return (
		<div className="flex flex-wrap gap-2">
			{countries.map((country, index) => {
				const ancestry = getCountryAncestry(country);

				return (
					<LinkWithParams
						key={index}
						href={pathname}
						params={{ country: ancestry }}
						className="opacity-100"
					>
						<Card
							key={index}
							className="flex gap-2 items-center px-4 py-1"
							color="tertiary"
						>
							<div className="flex gap-2 items-center">
								<Image
									src={`https://flagcdn.com/w40/${country.toLowerCase()}.png`}
									alt={country}
									width={16}
									height={12}
								/>
								<div>{country}</div>
							</div>
						</Card>
					</LinkWithParams>
				);
			})}
		</div>
	);
}

function ItemCreators({ value, t, pathname }: FormatterProps) {
	const isAuthorFilterEnabled = useLibraryFeature("authorFilter");
	if (!value) return null;
	if (value.length === 0) return null;

	return (
		<ul className="flex flex-col lg:gap-2">
			{value.map((creator: Creator, index: number) => {
				const creatorTypeLabel = t(
					"creatorType." + creator.creatorType,
				);
				const { creatorType, institutions, ...rest } = creator;
				const fullName = creator.name
					? creator.name
					: `${creator.firstName} ${creator.lastName}`;

				const AuthorContent = () => {
					return (
						<p className="space-x-1">
							<span
								className={twMerge(
									"font-medium text-accent",
									isAuthorFilterEnabled && "underline",
								)}
							>
								{Object.values(rest).filter(Boolean).join(", ")}
							</span>
							<span
								className={twMerge(
									"text-black/80 dark:text-white/80 capitalize",
									!creatorTypeLabel && "!text-red-500",
								)}
							>
								({creatorTypeLabel || creator.creatorType})
							</span>
						</p>
					);
				};
				return (
					<li key={index}>
						{isAuthorFilterEnabled ? (
							<LinkWithParams
								href={pathname}
								params={{ author: fullName }}
								className="text-lg"
							>
								<AuthorContent />
							</LinkWithParams>
						) : (
							<AuthorContent />
						)}
					</li>
				);
			})}
		</ul>
	);
}

function ItemInstitution({ value, t, pathname }: FormatterProps) {
	const { filters, institutions: configuredInstitutions } =
		useLibraryConfig();
	const isInstitutionFilterEnabled = filters.institution.mode !== "hidden";
	if (!value) return false;

	// Handle both string and array values
	const institutions = Array.isArray(value) ? value : [value];

	if (institutions.length === 0) return false;

	return (
		<div className="flex flex-wrap gap-2">
			{institutions.map((institution, index) => {
				const configuredInstitution = findInstitutionWithLogo(
					configuredInstitutions,
					institution,
				);

				const InstitutionContent = () => {
					return (
						<Card
							className="max-w-fit p-2 rounded-2xl"
							color="accent"
						>
							<div
								className={twMerge(
									"flex gap-2 items-center",
									!configuredInstitution && "px-2",
								)}
							>
								{configuredInstitution?.logoUrl && (
									<InstitutionLogo
										alt=""
										logoUrl={configuredInstitution.logoUrl}
									/>
								)}
								<h3 className="text-white/80">{institution}</h3>
							</div>
						</Card>
					);
				};

				return isInstitutionFilterEnabled ? (
					<LinkWithParams
						key={index}
						href={pathname}
						params={{ institution: [institution] }}
					>
						<InstitutionContent key={index} />
					</LinkWithParams>
				) : (
					<InstitutionContent key={index} />
				);
			})}
		</div>
	);
}

export const valueFormatter: Record<
	any,
	(props: FormatterProps) => ReactNode | boolean
> = {
	key: (value) => false,
	updatedAt: () => false,
	createdAt: () => false,
	tags: () => false,
	sourceConnectionKey: () => false,
	sourceRecordKey: () => false,
	sourceExternalScopeKey: () => false,
	provider: () => false,
	revision: () => false,
	dateAdded: () => false,
	fullTextPDFs: () => false,
	dateModified: () => false,
	datePublished: () => false,
	deleted: () => false,
	deletedAt: () => false,
	year: () => false,
	collectionsAncestry: () => false,
	fullNames: () => false,
	itemType: ({ value, t }) => <p>{t("itemType." + value)}</p>,
	title: () => false,
	relations: ({ value }) => <Relations value={value} />,
	note: ({ value }) => (
		<p
			dangerouslySetInnerHTML={{ __html: value }}
			className="text-lg text-black/80 dark:text-white/80 font-medium break-words w-full"
		/>
	),
	callNumber: () => false,
	DOI: ({ value }) => {
		if (!value) return false;
		return <Extra value={value} />;
	},
	creators: ItemCreators,
	collectionsData: () => false,
	date: formatDate,
	accessDate: formatAccessDate,
	url: ({ value }) => (
		<Link
			href={value}
			underline="always"
			className="text-link break-all text-lg"
			showAnchorIcon
		>
			{value}
		</Link>
	),
	attachmentsData: ({ value, item }) => {
		const filteredValue = value.filter(
			(data: any) => data.PDFCoverPageImage,
		);

		if (filteredValue.length === 0) return false;

		return (
			<ul className="flex flex-col gap-2 lg:w-2/3 w-full">
				{value
					.filter((data: any) => data.PDFCoverPageImage)
					.map((data: Item, index: number) => (
						<Attachment data={data} key={index} item={item!} />
					))}
			</ul>
		);
	},
	extra: (args) => {
		return false;
		const finalValue = args.value;
		const values = getExtraValues(finalValue);
		return <ObjectView value={values} args={args} />;
	},
	citation: (args) => {
		return <Citation {...args} />;
	},
	country: ItemCountry,
	institution: ItemInstitution,
};
