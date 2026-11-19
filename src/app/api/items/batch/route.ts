import { NextRequest, NextResponse } from "next/server";
import { ListItem } from "@/app/api/item/types";
import { LIST_ITEM_FIELDS, publicFields, searchKeys, toLightweightItem } from "@/lib/search";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { filterPublicAttachments } from "@/lib/attachment-visibility";
import { hasAnyTag, publicTagRules } from "@/lib/tags";

async function getPaginatedItems(
	keys: string[],
	page: number,
	perPage: number,
	includeHeavyFields: boolean,
	libraryConfig: LibraryServerConfig,
): Promise<{ items: ListItem[]; total: number }> {
	if (keys.length === 0) return { items: [], total: 0 };

	try {
		const result = await searchKeys(libraryConfig, keys, { number: page, size: perPage }, {
			returned: includeHeavyFields ? publicFields(libraryConfig) : { only: [...LIST_ITEM_FIELDS] },
		});

		const items = result.hits;
		const { tags } = libraryConfig.content;
		return {
			items: items.map((item) =>
				includeHeavyFields
					? { ...item, attachmentsData: filterPublicAttachments(item, publicTagRules(libraryConfig)) }
					: toLightweightItem(item, publicTagRules(libraryConfig)),
			),
			total: result.total,
		};
	} catch (error: any) {
		console.warn("Error fetching items from search:", error);
		return { items: [], total: 0 };
	}
}

export type ItemsBatchResponse = {
	items: ListItem[];
	page: number;
	perPage: number;
	total: number;
	totalPages: number;
};

export async function POST(request: NextRequest) {
	const body = await request.json();
	const keys = body.keys;
	const page = body.page || 1;
	const perPage = body.perPage || 20;
	const includeHeavyFields = body.includeHeavyFields === true;
	const libraryConfig = await getLibraryConfig();

	if (!keys || !Array.isArray(keys) || keys.length === 0) {
		return NextResponse.json<ItemsBatchResponse>(
			{
				items: [],
				page,
				perPage,
				total: 0,
				totalPages: 0,
			},
			{
				headers: {
					"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
				},
			}
		);
	}

	const { items, total } = await getPaginatedItems(
		keys,
		page,
		perPage,
		includeHeavyFields,
		libraryConfig,
	);

	// Filter out deleted items and items with blocked tags
	const filteredItems = items.filter(
		(item) =>
			!item.deleted &&
			!hasAnyTag(item.tags, libraryConfig.content.tags.hidden)
	);

	const totalPages = Math.ceil(total / perPage);

	return NextResponse.json<ItemsBatchResponse>(
		{
			items: filteredItems,
			page,
			perPage,
			total,
			totalPages,
		},
		{
			headers: {
				"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
			},
		}
	);
}
