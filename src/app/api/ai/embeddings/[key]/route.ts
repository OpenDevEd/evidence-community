import { getCachedItem } from "@/app/api/cache";
import { getItem } from "@/app/api/item/[key]/route";
import { Item } from "@/app/api/item/types";
import client from "@/lib/meilisearch";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
	request: NextRequest,
	{ params }: { params: { key: string } }
) {
	const { key } = params;

	const itemResponse = await getCachedItem(key);

	if (!itemResponse) {
		return NextResponse.json({ error: "Item not found" }, { status: 404 });
	}

	const item: any = itemResponse.item;

	const result = await client
		.index(process.env.MEILI_INDEX! || "items")
		.search("", {
			q: `This ${item?.itemType || "document"} ${
				item?.title ? `entitled '${item?.title}'` : "(Untitled)"
			} ${
				item?.fullNames?.length
					? `was authored by ${item.fullNames.join(", ")}`
					: "has unknown authors"
			}${item?.institution ? ` while at ${item.institution}` : ""}${
				item?.date ? `. It was published on ${item.date}` : ""
			}${
				item?.collections?.length
					? `. It is categorized under ${item.collections.join(", ")}`
					: ""
			}${item?.url ? `. The work can be accessed at ${item.url}` : ""}${
				item?.abstract ? `. Abstract: '${item.abstract}'` : ""
			}`.substring(0, 4000),
			hybrid: {
				embedder: "openai",
				semanticRatio: 0.7,
			},
			filter: [`id != ${item.id}`],
		});

	return NextResponse.json(result);
}
