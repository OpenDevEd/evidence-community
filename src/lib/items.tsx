import { ReactNode, useRef, useMemo, memo, useState, useEffect } from "react";
import { Item } from "@/app/api/item/types";
import { Collection } from "@/app/api/collections/types";
import { Divider, Link } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import Attachment from "@/components/features/items/Attachment";
import { createFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import CopyButton from "@/components/features/items/CopyButton";
import { Card } from "@/components/nextui/Card";
import { INSTITUTION_LOGOS } from "@/constants/items";
import { getExtraValues } from "./utils";
import { Skeleton } from "@/components/nextui/Skeleton";
import LinkWithParams from "@/components/features/LinkWithParams";
import React from "react";
import { motion } from "framer-motion";
import Image from "next/image";

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

	return <p>{returnedDate}</p>;
}

function Citation({ value, loading }: FormatterProps) {
	const contentRef = useRef(null);
	const [showSkeleton, setShowSkeleton] = useState(true);
	const sanitizedHtml = value.trim().replace(/<\/?div/g, "<p");

	useEffect(() => {
		const timer = setTimeout(() => {
			setShowSkeleton(false);
		}, 250);

		return () => clearTimeout(timer);
	}, []);

	return (
		<Skeleton
			isLoaded={!loading && !showSkeleton}
			className="w-full min-h-16 rounded-2xl"
		>
			<motion.div
				initial={{ height: "5rem" }}
				animate={loading ? { height: "5rem" } : { height: "auto" }}
				transition={{ duration: 0.2, ease: "easeOut" }}
				className="flex gap-4 w-full bg-black/[4%] dark:bg-secondary-300 border border-white/[4%] p-4 rounded-2xl justify-between break-all"
			>
				<p
					ref={contentRef}
					dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
				/>
				<CopyButton isIconOnly contentRef={contentRef} />
			</motion.div>
		</Skeleton>
	);
}

function createRegexParser(wrappers: WrapperConfig[], tag: string = "p") {
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

		return !tag ? <>{elements}</> : React.createElement(tag, {}, elements);
	});
}

const DOIWrapper = ({ match, index }: MatchWrapperProps) => (
	<Link
		key={index}
		href={`https://doi.org/${match}`}
		underline="always"
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
		underline="always"
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
		<li className="flex flex-col">
			<Link
				showAnchorIcon
				href={href}
				className="dark:text-collection text-collection_light text-lg"
				underline="always"
			>
				<span className="dark:text-collection text-collection_light">
					{collection.name}
				</span>
			</Link>
			<ul className="ml-8">
				{collection.children?.map((child) => (
					<CollectionLevel key={child.id} collection={child} />
				))}
			</ul>
		</li>
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

function ObjectView({
	value,
	args,
}: {
	value: Map<string, any> | Record<string, any>;
	args: FormatterProps;
}) {
	if (!(value instanceof Map)) {
		value = new Map(
			Object.entries(value).map(([key, value]) => [key, String(value)])
		);
	}

	const filteredValues: [string, string][] = Array.from(value.entries());

	const ExtraSpan = createRegexParser(
		[
			{ regex: doiRegex, Wrapper: DOIWrapper, priority: 1 },
			{ regex: urlRegex, Wrapper: URLWrapper, priority: 2 },
		],
		"span"
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
	datePublished: () => false,
	relations: () => false,
	deleted: () => false,
	year: () => false,
	collectionsAncestry: () => false,
	fullNames: () => false,
	itemType: ({ value, t }) => <p>{t("itemType." + value)}</p>,
	collections: () => false,
	title: () => false,
	note: ({ value }) => (
		<p
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
					const fullName = creator.name
						? creator.name
						: `${creator.firstName} ${creator.lastName}`;
					return (
						<li key={index}>
							<LinkWithParams
								href="/lib"
								params={{ author: fullName }}
								className="text-lg"
							>
								<p className="space-x-1">
									<span className="font-medium text-accent underline">
										{Object.values(rest)
											.filter(Boolean)
											.join(", ")}
									</span>
									<span
										className={twMerge(
											"text-black/80 dark:text-white/80 capitalize",
											!creatorTypeLabel && "!text-red-500"
										)}
									>
										(
										{creatorTypeLabel ||
											creator.creatorType}
										)
									</span>
								</p>
							</LinkWithParams>
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
			underline="always"
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
			<ul className="flex flex-col gap-2 xl:w-2/3 w-full">
				{value
					.filter((data: any) => data.PDFCoverPageImage)
					.map((data: Item, index: number) => (
						<Attachment data={data} key={index} />
					))}
			</ul>
		);
	},
	extra: (args) => {
		const finalValue = args.value;
		const values = getExtraValues(finalValue);
		return <ObjectView value={values} args={args} />;
	},
	apc_list: (args) => {
		const finalValue = args.value;
		return false;
		return <ObjectView value={finalValue} args={args} />;
	},
	apc_paid: (args) => {
		const finalValue = args.value;
		return false;
		return <ObjectView value={finalValue} args={args} />;
	},
	citation: (args) => {
		return <Citation {...args} />;
	},
	country: ({ value }) => {
		if (!value) return false;

		const countries = Array.isArray(value) ? value : [value];

		if (countries.length === 0) return false;

		return (
			<div className="flex flex-wrap gap-2">
				{countries.map((country, index) => {
					return (
						<LinkWithParams
							key={index}
							href="/lib"
							params={{ country }}
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
	},
	institution: ({ value }) => {
		if (!value) return false;

		// Handle both string and array values
		const institutions = Array.isArray(value) ? value : [value];

		console.log("institution", value);

		if (institutions.length === 0) return false;

		return (
			<div className="flex flex-wrap gap-2">
				{institutions.map((institution, index) => {
					const InstitutionLogo = Object.entries(
						INSTITUTION_LOGOS
					).find(([key]) => institution.includes(key))?.[1];

					return (
						<LinkWithParams
							key={index}
							href="/lib"
							params={{ institution }}
						>
							<Card
								className="max-w-fit p-2 rounded-2xl"
								color="accent"
							>
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
										{institution}
									</h3>
								</div>
							</Card>
						</LinkWithParams>
					);
				})}
			</div>
		);
	},
};
