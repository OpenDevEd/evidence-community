import { item } from "@/db/schema/tables/item";
import { getTableColumns } from "drizzle-orm";
import Image from "next/image";
import AboutUs from "@/components/icons/AboutUs";
import { twMerge } from "tailwind-merge";

const InstitutionLogo = ({ src, alt, className, ...props }: { src: string; alt: string; className?: string } & React.ComponentProps<typeof Image>) => (
	<Image
		src={src}
		alt={alt}
		width={24}
		height={24}
		className={twMerge("size-6 object-contain dark:bg-white/80 p-0.5 rounded-md", className)}
		{...props}
	/>
);

const OpenDevLogo = ({ className, ...props }: { className: string } & React.HTMLAttributes<HTMLDivElement>) => (
	<div className={twMerge("flex justify-center items-center dark:bg-white/80 text-accent p-0.5 rounded-md size-6", className)} {...props}>
		<AboutUs className="fill-current size-full" />
	</div>
);

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
};

export const ITEMS_PER_PAGE = 20;

export const EXCLUDED_ITEM_TYPES = ["Note", "Attachment"];

export const SORT_OPTIONS = [
	{ key: "desc", name: "Newest", sort: "dateAdded:desc" },
	{ key: "asc", name: "Oldest", sort: "dateAdded:asc" },
	{ key: "authorAZ", name: "Author A-Z", sort: "fullNames:asc" },
	{ key: "authorZA", name: "Author Z-A", sort: "fullNames:desc" },
	{ key: "titleAZ", name: "Title A-Z", sort: "title:asc" },
	{ key: "titleZA", name: "Title Z-A", sort: "title:desc" },
];

export const ITEM_COLUMNS = Object.values(getTableColumns(item)).map(
	(col: any) => col.name
);

export const SCOPE_OPTIONS = [
	{ key: "everywhere", name: "Everywhere", attributesToSearchOn: ["*"] },
	{
		key: "authors",
		name: "in authors or contributors",
		attributesToSearchOn: ["fullNames"],
	},
	{ key: "title", name: "in title", attributesToSearchOn: ["title"] },
	{
		key: "fields",
		name: "in fields",
		attributesToSearchOn: ITEM_COLUMNS.filter(
			(col) => col !== "fullTextPDF" && col !== "attachmentsData"
		),
	},
	{
		key: "documents",
		name: "in documents",
		attributesToSearchOn: [
			"fullTextPDF",
			"attachmentsData.fullTextPDF.text",
		],
	},
];
