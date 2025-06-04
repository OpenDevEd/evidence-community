import { item } from "@/db/schema/tables/item";
import { getTableColumns } from "drizzle-orm";
import Image from "next/image";
import AboutUs from "@/components/icons/AboutUs";
import { twMerge } from "tailwind-merge";
import { useTranslations } from "next-intl";

const InstitutionLogo = ({ src, alt, className,  ...props }: { src: string; alt: string; className?: string } & React.ComponentProps<typeof Image>) => {
	const t = useTranslations("ui");
	return (
		<Image
			src={src}
			alt={t("institutionLogoAlt", { name: alt })}
			width={24}
			height={24}
			className={twMerge("size-6 object-contain dark:bg-white/80 p-0.5 rounded-md", className)}
			{...props}
		/>
	);
};

const OpenDevLogo = ({ className, ...props }: { className: string } & React.HTMLAttributes<HTMLDivElement>) => {
	const t = useTranslations("ui");
	return (
		<div aria-label={t("institutionLogoAlt", { name: "Open Development & Education" })} className={twMerge("flex justify-center items-center dark:bg-white/80 text-accent p-0.5 rounded-md size-6", className)} {...props}>
			<AboutUs className="fill-current size-full" />
		</div>
	);
};

export const INSTITUTION_LOGOS: Record<string, any> = {
	"EdTech Hub": (props: React.ComponentProps<typeof InstitutionLogo>) => (
		<InstitutionLogo
			{...props}
			src="/institutions/EdTechHub.png"
			alt="EdTech Hub"
		/>
	),
	"Open Development & Education": (props: React.ComponentProps<typeof OpenDevLogo>) => <OpenDevLogo {...props} />,
	IIEP: (props: React.ComponentProps<typeof InstitutionLogo>) => (
		<InstitutionLogo {...props} src="/institutions/IIEP.png" alt="IIEP" />
	),
	"British Standards Institution": (props: React.ComponentProps<typeof InstitutionLogo>) => (
		<InstitutionLogo {...props} src="/institutions/BSI.png" alt="BSI" />
	),
	"UK National Commission to UNESCO": (props: React.ComponentProps<typeof InstitutionLogo>) => (
		<InstitutionLogo
			{...props}
			src="/institutions/UKUNESCO.png"
			alt="UK National Commission to UNESCO"
		/>
	),
	"eEkitabu": (props: React.ComponentProps<typeof InstitutionLogo>) => (
		<InstitutionLogo
			{...props}
			src="/institutions/eEkitabu.png"
			alt="eEkitabu"
		/>
	),
	"United Nations": (props: React.ComponentProps<typeof InstitutionLogo>) => (
		<InstitutionLogo
			{...props}
			src="/institutions/UN.png"
			alt="United Nations"
		/>
	),
	"UNICEF": (props: React.ComponentProps<typeof InstitutionLogo>) => (
		<InstitutionLogo
			{...props}
			src="/institutions/UNICEF.png"
			alt="UNICEF"
		/>
	),
};

export const ITEMS_PER_PAGE = 20;

export const EXCLUDED_ITEM_TYPES = ["Note", "Attachment"];

export const SORT_OPTIONS = [
	{ key: "desc", legacyKey: "date_desc", name: "Newest", sort: "datePublished:desc" },
	{ key: "asc", legacyKey: "date_asc", name: "Oldest", sort: "datePublished:asc" },
	// { key: "dateAddedDesc", name: "Date Added (Newest)", sort: "dateAdded:desc" },
	// { key: "dateAddedAsc", name: "Date Added (Oldest)", sort: "dateAdded:asc" },
	{ key: "authorAZ", legacyKey: "author_asc", name: "Author A-Z", sort: "fullNames:asc" },
	{ key: "authorZA", legacyKey: "author_desc", name: "Author Z-A", sort: "fullNames:desc" },
	{ key: "titleAZ", legacyKey: "title_asc", name: "Title A-Z", sort: "title:asc" },
	{ key: "titleZA", legacyKey: "title_desc", name: "Title Z-A", sort: "title:desc" },
];

export const ITEM_COLUMNS = Object.values(getTableColumns(item)).map(
	(col: any) => col.name
);

// export const SCOPE_OPTIONS = [
// 	{
// 		key: "title_and_abstract",
// 		legacyKey: "title_and_abstract",
// 		name: "in title and abstract",
// 		attributesToSearchOn: ["title", "abstractNote"],
// 	},
// 	{ key: "everywhere", legacyKey: "all", name: "Everywhere", attributesToSearchOn: ["*"] },
// 	{
// 		key: "authors",
// 		legacyKey: "creator",
// 		name: "in authors or contributors",
// 		attributesToSearchOn: ["fullNames"],
// 	},
// 	{ key: "title", legacyKey: "title", name: "in title", attributesToSearchOn: ["title"] },
// 	{
// 		key: "fields",
// 		legacyKey: "metadata",
// 		name: "in fields",
// 		attributesToSearchOn: ["title", "abstractNote", "fullNames"],
// 	},
// 	{
// 		key: "documents",
// 		legacyKey: "fulltext",
// 		name: "in documents",
// 		attributesToSearchOn: [
// 			"fullTextPDFs.fullTextPDF.text",
// 		],
// 	}
// ];

export const SCOPE_OPTIONS = [
	{
		key: "title_abstract_and_keywords",
		legacyKey: "title_and_abstract",
		name: "Title, abstract and keywords",
		attributesToSearchOn: ["title", "abstractNote", "tags"],
	},
	{
		key: "title_and_abstract",
		legacyKey: "title_and_abstract",
		name: "Title and abstract",
		attributesToSearchOn: ["title", "abstractNote"],
	},
	{
		key: "title",
		legacyKey: "title",
		name: "Title only",
		attributesToSearchOn: ["title"],
	},
	{
		key: "authors",
		legacyKey: "creator",
		name: "Authors and contributors",
		attributesToSearchOn: ["fullNames"],
	},
	{
		key: "fields",
		legacyKey: "metadata",
		name: "All metadata",
		attributesToSearchOn: ["title", "abstractNote", "fullNames", "tags"],
	},
	{
		key: "documents",
		legacyKey: "fulltext",
		name: "Full text only",
		attributesToSearchOn: [
			"fullTextPDFs.fullTextPDF.text",
		],
	},
	{
		key: "everywhere",
		legacyKey: "all",
		name: "Everywhere",
		attributesToSearchOn: ["*"],
	},
]



export const COMING_SOON_TAG = process.env.NEXT_PUBLIC_COMING_SOON_TAG || "_comingsoon"
export const INTERNAL_TAG = process.env.NEXT_PUBLIC_INTERNAL_TAG || "internal"
export const HIDE_TAG = process.env.NEXT_PUBLIC_HIDE_TAG || "hide"