import { item } from "@/db/schema/tables/item";
import { getTableColumns } from "drizzle-orm";
import Image from "next/image";
import AboutUs from "@/components/icons/AboutUs";

export const INSTITUTION_LOGOS: Record<string, React.ReactNode> = {
	"EdTech Hub": (
		<Image
			src="/institutions/EdTechHub.png"
			alt="EdTech Hub"
			width={24}
			height={24}
			className="size-6 object-contain dark:bg-white/80 p-0.5 rounded-md"
		/>
	),
	"Open Development & Education": <AboutUs className="fill-accent size-6" />,
	IIEP: (
		<Image
			src="/institutions/IIEP.png"
			alt="IIEP"
			width={24}
			height={24}
			className="size-6 object-contain dark:bg-white/80 p-0.5 rounded-md"
		/>
	),
	"British Standards Institution": (
		<Image
			src="/institutions/BSI.png"
			alt="BSI"
			width={24}
			height={24}
			className="size-6 object-contain dark:bg-white/80 p-0.5 rounded-md"
		/>
	),
	"UK National Commission to UNESCO": (
		<Image
			src="/institutions/UKUNESCO.png"
			alt="UK National Commission to UNESCO"
			width={24}
			height={24}
			className="size-6 object-contain dark:bg-white/80 p-0.5 rounded-md"
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

export const ITEM_COLUMNS = Object.values(getTableColumns(item)).map((col: any) => col.name);

export const SCOPE_OPTIONS = [
  { key: "everywhere", name: "Everywhere", attributesToSearchOn: ["*"] },
  { key: "authors", name: "in authors or contributors", attributesToSearchOn: ["fullNames"] },
  { key: "title", name: "in title", attributesToSearchOn: ["title"] },
  { key: "fields", name: "in fields", attributesToSearchOn: ITEM_COLUMNS.filter((col) => col !== "fullTextPDF" && col !== "attachmentsData") },
  { key: "documents", name: "in documents", attributesToSearchOn: ["fullTextPDF", "attachmentsData.fullTextPDF.text"] },
];
