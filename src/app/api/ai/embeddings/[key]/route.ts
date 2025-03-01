import { getCachedItem, getCachedItemSmall } from "@/app/api/cache";
import { getItem } from "@/app/api/item/[key]/route";
import { Item } from "@/app/api/item/types";
import client from "@/lib/meilisearch";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, props: { params: Promise<{ key: string }> }) {
    const params = await props.params;
    const { key } = params;

    const itemResponse = await getCachedItemSmall(key);

    if (!itemResponse) {
		return NextResponse.json({ error: "Item not found" }, { status: 404 });
	}

    const item: any = itemResponse.item;

	const institution = Array.isArray(item.institution) ? item.institution.join(', ') : item.institution;

    const description = `This ${item.itemType || 'document'} ${
		item.title ? `entitled '${item.title}'` : '(Untitled)'
	} ${
		item.fullNames?.length > 0 
			? `was authored by ${item.fullNames.join(', ')}` 
			: 'has unknown authors'
	}${
		institution?.length > 0 
			? ` while at ${institution}` 
			: ''
	}. ${
		item.date ? `It was published on ${item.date}` : ''
	}${
		item.collections?.length > 0 
			? ` and is categorized under ${item.collections.join(', ')}` 
			: ''
	}${
		item.url ? `. The work can be accessed at ${item.url}` : ''
	}${
		item.abstractNote ? `. The authors provide the following abstract: '${item.abstractNote}'` : ''
	}`;

    const result = await client
		.index(process.env.MEILI_INDEX! || "items")
		.search("", {
			q: description,
			hybrid: {
				embedder: "openai",
				semanticRatio: 0.7,
			},
			filter: [`key != ${key}`],
			limit: 5,
		});

    return NextResponse.json(result);
}
