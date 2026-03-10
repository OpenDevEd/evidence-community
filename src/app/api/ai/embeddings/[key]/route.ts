import { getCachedItem, getCachedItemSmall } from "@/app/api/cache";
import { getItem } from "@/app/api/item/[key]/route";
import { Item } from "@/app/api/item/types";
import { EXCLUDED_ITEM_TYPES } from "@/constants/items";
import { blockedTags } from "@/constants/misc";
import client from "@/lib/meilisearch";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, props: { params: Promise<{ key: string }> }) {
	if (process.env.NEXT_PUBLIC_DISABLE_EMBEDDINGS === "true") {
		return NextResponse.json({ hits: [], totalHits: 0 }, {
			headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL },
		});
	}

	const params = await props.params;
	const { key } = params;

	const itemResponse = await getCachedItemSmall(key);

	if (!itemResponse) {
		return NextResponse.json({ error: "Item not found" }, {
			status: 404,
		});
	}

	const item: any = itemResponse.item;
	const institutionValue = item.institution || "";

	const institution = Array.isArray(institutionValue) ? institutionValue.join(', ') : institutionValue;

	const description = `This ${item.itemType || 'document'} ${item.title ? `entitled '${item.title}'` : '(Untitled)'
		} ${item.fullNames?.length > 0
			? `was authored by ${item.fullNames.join(', ')}`
			: 'has unknown authors'
		}${institution?.length > 0
			? ` while at ${institution}`
			: ''
		}. ${item.date ? `It was published on ${item.date}` : ''
		}${item.collections?.length > 0
			? ` and is categorized under ${item.collections.join(', ')}`
			: ''
		}${item.url ? `. The work can be accessed at ${item.url}` : ''
		}${item.abstractNote ? `. The authors provide the following abstract: '${item.abstractNote}'` : ''
		}`;

	const result = await client
		.index(process.env.MEILI_INDEX! || "items")
		.search("", {
			q: description,
			hybrid: {
				embedder: "openai",
				semanticRatio: 0.7,
			},
			filter: [
				`key != ${key}`,
				`itemType NOT IN ${JSON.stringify(EXCLUDED_ITEM_TYPES)}`,
				"deleted != 1",
				`tags NOT IN ${JSON.stringify(blockedTags)}`
			],
			limit: 6,
		});

	return NextResponse.json(result, {
		headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL },
	});
}
