import { Item, ItemGetResponse, Author } from "@/app/api/item/types";
import { getCurrentItem } from "@/app/[locale]/lib/[key]/page";
import PageContainer from "@/components/layout/PageContainer";
import { Card } from "@/components/nextui/Card";
import { FaCalendar } from "react-icons/fa";
import { RelationsType } from "@/types/item";
import {
	IoBook,
	IoDocumentText,
	IoOpenOutline,
	IoDownloadOutline,
	IoChevronBack,
} from "react-icons/io5";
import { Avatar } from "@nextui-org/avatar";
import { HiAcademicCap } from "react-icons/hi2";
import { useFormatter, useTranslations } from "next-intl";
import { Divider } from "@nextui-org/react";
import CopyButton from "@/components/features/newlib/CopyButton";
import { Button } from "@/components/nextui/Button";
import { Collection } from "@/app/api/collections/types";
import { twMerge } from "tailwind-merge";
import { CountryDisplay } from "@/components/features/newlib/CountryDisplay";
import Attachment from "@/components/features/items/Attachment";
import VectorRelations from "@/components/features/newlib/VectorRelations";
import { getExtraValues } from "@/lib/utils";
import Relations from "@/components/features/newlib/Relations";
import { DownloadButton } from "@/components/features/newlib/DownloadModal";
import { SiZotero } from "react-icons/si";
import AiWrapper from "@/components/features/newlib/AiWrapper";
import { notFound } from "next/navigation";
import { Suspense } from "react";

function getCitationCount(item: Item | undefined) {
	if (!item) return 0;
	const relations = item.relations as RelationsType;
	return relations?.cited_by || 0;
}

function formatInstitutions(institutions: string[] | undefined) {
	if (!institutions || institutions.length === 0) return "";
	if (institutions.length === 1) return institutions[0];
	return `${institutions[0]} +${institutions.length - 1} others`;
}

function HeaderSection({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex items-center gap-2 text-black/60 dark:text-white/60">
			{children}
		</div>
	);
}

function ItemHeaderInstitution({ item }: { item: Item | undefined }) {
	if (!item?.institution?.length) return null;
	return (
		<Card className="p-1 px-3 text-sm bg-default-100">
			{formatInstitutions(item?.institution as string[])}
		</Card>
	);
}

interface ItemRowProps {
	icon: React.ReactNode;
	title: string;
	subtitle?: React.ReactNode;
}

function ItemRow({ icon, title, subtitle }: ItemRowProps) {
	return (
		<div className="flex items-center gap-3 px-4">
			{icon}
			<div className="flex flex-col">
				<div className="text-base font-medium">{title}</div>
				{subtitle}
			</div>
		</div>
	);
}

function ItemHeader({ item }: { item: Item | undefined }) {
	const tItemType = useTranslations("itemType");
	const url = process.env.BASE_URL + "/newlib/" + item?.key;

	return (
		<div className="w-full flex items-center gap-4 flex-wrap">
			<Button
				variant="transparent"
				size="sm"
				className="rounded-2xl"
				startContent={<IoChevronBack />}
			>
				Back
			</Button>
			{/* <div className="text-black/60 dark:text-white/60">/</div> */}
			<ItemHeaderInstitution item={item} />
			<div className="flex items-center gap-4 flex-wrap">
				<HeaderSection>
					<FaCalendar className="size-4" />
					{item?.year}
				</HeaderSection>
				<HeaderSection>
					<IoBook className="size-4" />
					{getCitationCount(item)} citations
				</HeaderSection>
				<HeaderSection>
					<IoDocumentText className="size-4" />
					{tItemType(item?.itemType)}
				</HeaderSection>
			</div>

			<div className="ml-auto flex flex-row-reverse items-center gap-2 flex-wrap">
				{item?.url && (
					<a href={item.url} target="_blank">
						<Button
							size="sm"
							color="accent"
							startContent={<IoOpenOutline />}
						>
							View Original
						</Button>
					</a>
				)}
				<CopyButton textToCopy={url}>
					<Button isIconOnly size="sm"></Button>
				</CopyButton>
				<DownloadButton
					size="sm"
					fileName={item?.key || ""}
					isIconOnly
					itemData={item}
					startContent={<IoDownloadOutline />}
				/>
				<Button size="sm" startContent={<SiZotero />}>
					View on Zotero.org
				</Button>
				<Button size="sm" startContent={<SiZotero />}>
					Open in Zotero
				</Button>
			</div>
		</div>
	);
}

function ItemTitle({ item }: { item: Item | undefined }) {
	return (
		<h1
			dangerouslySetInnerHTML={{ __html: item?.title || "" }}
			className="text-3xl font-medium"
		></h1>
	);
}

function formatAuthor(author: Author) {
	if (author.name) return author.name;
	return [author.lastName, author.firstName].filter(Boolean).join(", ");
}

interface SidebarCardProps {
	title: string;
	count?: number;
	children: React.ReactNode;
	classNames?: {
		card?: string;
		titleWrapper?: string;
		title?: string;
		count?: string;
		content?: string;
	};
	color?: "card" | "transparent";
}
function SidebarCard({
	title,
	count,
	children,
	classNames,
	color = "card",
}: SidebarCardProps) {
	return (
		<Card
			color={color}
			className={twMerge("p-4 px-0 pb-0", classNames?.card)}
		>
			<div
				className={twMerge(
					"flex justify-between items-center gap-2 mb-4 px-4",
					classNames?.titleWrapper
				)}
			>
				<h3
					className={twMerge(
						"text-lg font-medium",
						classNames?.title
					)}
				>
					{title}
				</h3>
				{count && (
					<div
						className={twMerge(
							"text-sm text-black/60 dark:text-white/60",
							classNames?.count
						)}
					>
						{count}
					</div>
				)}
			</div>
			<div
				className={twMerge(
					"flex flex-col gap-4 max-h-96 overflow-y-auto pb-4 overflow-x-hidden text-wrap-anywhere",
					classNames?.content
				)}
			>
				{children}
			</div>
		</Card>
	);
}

function ItemAuthor({ author }: { author: Author }) {
	const t = useTranslations("creatorType");
	const creatorTypeLabel = t(author.creatorType);

	const subtitle = (
		<>
			{creatorTypeLabel && (
				<div className="text-xs text-black/60 dark:text-white/60">
					{creatorTypeLabel}
				</div>
			)}
		</>
	);

	return (
		<ItemRow
			icon={
				<Avatar
					name={formatAuthor(author).charAt(0)}
					size="sm"
					className="text-lg text-accent bg-accent/10 brightness-150 shrink-0"
				/>
			}
			title={formatAuthor(author)}
			subtitle={subtitle}
		/>
	);
}

function ItemAuthors({ item }: { item: Item | undefined }) {
	const authors = item?.creators as Author[];
	if (!authors?.length) return null;

	return (
		<SidebarCard title="Authors" count={authors.length}>
			{authors?.map((author: Author, index: number) => (
				<ItemAuthor key={index} author={author} />
			))}
		</SidebarCard>
	);
}

function ItemInstitution({ institution }: { institution: string }) {
	return (
		<ItemRow
			key={institution}
			icon={
				<div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg text-accent bg-accent/10 brightness-150 shrink-0">
					<HiAcademicCap />
				</div>
			}
			title={institution}
		/>
	);
}

function ItemInstitutions({ item }: { item: Item | undefined }) {
	const institutions = item?.institution as string[];
	if (!institutions?.length) return null;

	return (
		<SidebarCard title="Institutions" count={institutions.length}>
			{Array.from(new Set(institutions)).map((institution: string) => (
				<ItemInstitution key={institution} institution={institution} />
			))}
		</SidebarCard>
	);
}

function formatDate(value: string, formatter: ReturnType<typeof useFormatter>) {
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

	return returnedDate;
}

function formatValue(
	key: keyof Item,
	value: any,
	formatter: ReturnType<typeof useFormatter>
) {
	if (
		key.toLowerCase().includes("date") ||
		["createdAt", "updatedAt"].includes(key)
	) {
		return formatDate(value, formatter);
	}

	return value;
}

function ItemDetailsRow({ detail }: { detail: { label: string; value: any } }) {
	const t = useTranslations("article");
	const formatter = useFormatter();
	const formattedValue = formatValue(
		detail.label as keyof Item,
		detail.value,
		formatter
	);

	return (
		<div className="flex justify-between gap-2 px-4">
			<div key={detail.label} className="text-base font-medium flex-1">
				<div className="text-sm text-black/60 dark:text-white/60">
					{t(detail.label)}
				</div>
				<div className="flex justify-between">
					<div className="text-base">{formattedValue}</div>
				</div>
			</div>
			<CopyButton textToCopy={formattedValue} />
		</div>
	);
}

function ItemDetails({ item }: { item: Item | undefined }) {
	const excludedFields: (keyof Item)[] = [
		"title",
		"creators",
		"institution",
		"abstractNote",
		"citation",
		"collectionsData",
		"key",
		"fullNames",
		"id",
		"itemType",
		"version",
		"url",
		"country",
		"institution",
		"dateAdded",
		"dateModified",
		"deleted",
		"groupExternalId",
		"collections",
		"relations",
		"createdAt",
		"updatedAt",
		"collectionsAncestry",
		"date",
		"year",
		"apc_list",
		"apc_paid",
		"attachmentsData",
		"fullTextPDFs",
		"tags",
		"extra",
		"callNumber",
	];

	const t = useTranslations("article");
	if (!item) return null;

	const ExtraValues = getExtraValues(item.extra || "");
	item.DOI = item.DOI || ExtraValues.get("DOI") || null;

	const details = Object.entries(item)
		.filter(([key, value]) => value !== null)
		.map(([key, value]) => ({
			label: key,
			value: String(value),
		}));

	return (
		<SidebarCard title="Publication Details">
			<div className="flex flex-col gap-2">
				{details
					.filter(
						(detail) =>
							!excludedFields.includes(detail.label as keyof Item)
					)
					.map((detail) => (
						<ItemDetailsRow key={detail.label} detail={detail} />
					))}
			</div>
		</SidebarCard>
	);
}

function ItemTechnical({ item }: { item: Item | undefined }) {
	const technicalFields: (keyof Item)[] = [
		"id",
		"key",
		"createdAt",
		"updatedAt",
	];

	return (
		<SidebarCard
			classNames={{
				card: "pt-0 -mt-2 opacity-50 rounded-none shadow-none",
			}}
			title="Technical Details"
			color="transparent"
		>
			<div className="flex flex-col gap-2">
				{technicalFields.map((field) => (
					<ItemDetailsRow
						key={field}
						detail={{
							label: field,
							value: item?.[field as keyof Item] as string,
						}}
					/>
				))}
			</div>
		</SidebarCard>
	);
}

function ItemPropertyRowWrapper({
	children,
	title,
	copyText,
	className,
}: {
	children: React.ReactNode;
	title: string;
	copyText?: string;
	className?: string;
}) {
	return (
		<div className={twMerge("flex flex-col gap-4", className)}>
			<div className="flex items-center justify-between">
				<h3 className="text-xl font-medium">{title}</h3>
				{copyText && <CopyButton textToCopy={copyText} />}
			</div>
			{children}
		</div>
	);
}

function ItemAbstract({ item }: { item: Item | undefined }) {
	return (
		<ItemPropertyRowWrapper
			title="Abstract"
			copyText={item?.abstractNote || undefined}
		>
			<p className="text-base text-black/60 dark:text-white/60">
				{item?.abstractNote}
			</p>
		</ItemPropertyRowWrapper>
	);
}

function ItemCitation({ item }: { item: Item | undefined }) {
	const citationText = item?.citation?.replace(/<[^>]+>/g, "") || undefined;

	const decodeHTMLEntities = (text: string) => {
		return text
			.replace(/&amp;/g, "&")
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
			.replace(/&#x([0-9A-F]+);/gi, (_, hex) =>
				String.fromCharCode(parseInt(hex, 16))
			);
	};

	const citationTextWithSymbols = citationText
		? decodeHTMLEntities(citationText)
		: undefined;

	return (
		<ItemPropertyRowWrapper
			title="Citation"
			copyText={citationTextWithSymbols}
		>
			<p
				dangerouslySetInnerHTML={{ __html: item?.citation || "" }}
				className="text-base text-black/60 dark:text-white/60 text-wrap-anywhere"
			/>
		</ItemPropertyRowWrapper>
	);
}

function ItemCollections({ item }: { item: Item | undefined }) {
	const collectionsAncestry = item?.collectionsData as Collection[];

	// group by .title value
	const groupedCollections = collectionsAncestry.reduce((acc, collection) => {
		const title = collection.title || "Unknown";
		if (!acc[title]) {
			acc[title] = [];
		}
		acc[title].push(collection);
		return acc;
	}, {} as Record<string, Collection[]>);

	if (!Object.keys(groupedCollections).length) return null;

	return (
		<ItemPropertyRowWrapper title="Topics & Collections">
			<div className="flex flex-col gap-4">
				{Object.entries(groupedCollections).map(
					([title, collections]) => (
						<div key={title}>
							<h4 className="text-base font-medium uppercase text-black/60 dark:text-white/60 mb-2">
								{title}
							</h4>
							<ul className="text-base text-black/60 dark:text-white/60 flex flex-wrap gap-2">
								{collections.map((collection) => (
									<li key={collection.id}>
										<Card
											className="py-1 px-3"
											color="card"
										>
											{collection.name}
										</Card>
									</li>
								))}
							</ul>
						</div>
					)
				)}
			</div>
		</ItemPropertyRowWrapper>
	);
}

function ItemCountry({ item }: { item: Item | undefined }) {
	const countries = Array.isArray(item?.country) ? item.country : [];

	if (!countries.length) return null;

	return (
		<ItemPropertyRowWrapper title="Country Focus">
			<p className="text-black/60 dark:text-white/60">
				This publication is focused on the following countries.
			</p>
			<CountryDisplay countries={countries} />
		</ItemPropertyRowWrapper>
	);
}

function ItemAttachments({ item }: { item: Item | undefined }) {
	const validAttachments = item?.attachmentsData?.filter(
		(attachment) => attachment.PDFCoverPageImage
	);

	if (!validAttachments?.length) return null;

	return (
		<ItemPropertyRowWrapper title="Attachments">
			<p className="text-black/60 dark:text-white/60">
				The following attachments are available for this publication.
			</p>
			<div className="flex flex-col gap-4">
				{validAttachments.map((attachment) => (
					<Attachment key={attachment.id} data={attachment} />
				))}
			</div>
		</ItemPropertyRowWrapper>
	);
}

function ItemVectorRelations({ item }: { item: Item | undefined }) {
	return (
		<ItemPropertyRowWrapper
			className="[&:not(:has(#vector-relations))]:hidden"
			title="Recommended Resources"
		>
			<p className="text-black/60 dark:text-white/60">
				Based on the content of this publication, we recommend the
				following resources.
			</p>
			<VectorRelations item={item} />
		</ItemPropertyRowWrapper>
	);
}

function ItemRelations({ item }: { item: Item | undefined }) {
	const relations = item?.relations as RelationsType;
	if (!relations) return null;

	return (
		<ItemPropertyRowWrapper title="Related Resources">
			<p className="text-black/60 dark:text-white/60">
				The following resources are related to this publication by
				citation.
			</p>
			<Relations value={item?.relations as RelationsType} />
		</ItemPropertyRowWrapper>
	);
}

export async function ItemPage({ data }: { data: ItemGetResponse }) {
	const item = data?.item;

	return (
		<PageContainer>
			<div className="flex flex-col gap-6 lg:gap-14">
				<AiWrapper data={data} />
				<div className="flex flex-col gap-4">
					<ItemHeader item={item} />
					<ItemTitle item={item} />
				</div>
				<div className="flex flex-col lg:grid grid-cols-12 gap-8">
					<div className="col-span-8 xl:col-span-9 flex flex-col gap-12">
						{item?.abstractNote &&
							item?.abstractNote.length > 0 && (
								<>
									<ItemAbstract item={item} />
									<Divider />
								</>
							)}
						<ItemCitation item={item} />
						<ItemCollections item={item} />
						<ItemAttachments item={item} />
						<ItemCountry item={item} />
						<ItemVectorRelations item={item} />
						<ItemRelations item={item} />
					</div>
					<div className="col-span-4 xl:col-span-3">
						<div className="flex flex-col gap-8">
							<ItemAuthors item={item} />
							<ItemInstitutions item={item} />
							<ItemDetails item={item} />
							{/* <ItemTechnical item={item} /> */}
						</div>
					</div>
				</div>
			</div>
		</PageContainer>
	);
}

export default async function NewLibPage({
	params,
}: {
	params: { key: string };
}) {
	const { key } = await params;
	const data = await getCurrentItem(key);

	if (!data) {
		return notFound();
	}
	return <ItemPage data={data} />;
}
