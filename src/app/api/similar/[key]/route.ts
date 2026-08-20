import { getCachedItemSmall } from "@/app/api/cache";
import { EXCLUDED_ITEM_TYPES } from "@/constants/items";
import { blockedTags } from "@/constants/misc";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import client from "@/lib/meilisearch";
import { zoteroMarkupToPlainText } from "@/lib/zoteroMarkup";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
	_request: NextRequest,
	props: { params: Promise<{ key: string }> },
) {
	const { key } = await props.params;
	const itemResponse = await getCachedItemSmall(key);

	if (!itemResponse?.item) {
		return NextResponse.json({ error: "Item not found" }, { status: 404 });
	}

	const item = itemResponse.item;
	const institution = Array.isArray(item.institution)
		? item.institution.join(", ")
		: item.institution || "";
	const abstract = zoteroMarkupToPlainText(item.abstractNote);
	const description = `This ${item.itemType || "document"} ${
		item.title ? `entitled '${item.title}'` : "(Untitled)"
	} ${
		item.fullNames?.length
			? `was authored by ${item.fullNames.join(", ")}`
			: "has unknown authors"
	}${institution ? ` while at ${institution}` : ""}. ${
		item.date ? `It was published on ${item.date}` : ""
	}${
		item.collections?.length
			? ` and is categorized under ${item.collections.join(", ")}`
			: ""
	}${item.url ? `. The work can be accessed at ${item.url}` : ""}${
		abstract ? `. The authors provide the following abstract: '${abstract}'` : ""
	}`;

	const result = await client.index(process.env.MEILI_INDEX || "items").search("", {
		q: description,
		hybrid: {
			embedder: "openai",
			semanticRatio: 0.7,
		},
		filter: [
			`key != ${key}`,
			`itemType NOT IN ${JSON.stringify(EXCLUDED_ITEM_TYPES)}`,
			"deleted != 1",
			`tags NOT IN ${JSON.stringify(blockedTags)}`,
		],
		limit: 6,
	});

	return NextResponse.json(result, {
		headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL },
	});
}
