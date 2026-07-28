import { NextResponse } from "next/server";
import { Collection, CollectionsGetResponse } from "./types";
import { getCachedCollectionsResult } from "../cache";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";

export async function GET() {
	const result = await getCachedCollectionsResult();

	if (!result.ok) {
		return NextResponse.json(
			{
				error: "INVALID_LIBRARY_COLLECTIONS",
				missingIds: result.missingIds,
			},
			{
				status: 503,
				headers: { "Cache-Control": "no-store" },
			},
		);
	}

	return NextResponse.json<CollectionsGetResponse>(
		{
			collections: result.collections as Collection[],
		},
		{
			headers: {
				"Cache-Control": PUBLIC_READ_CACHE_CONTROL,
			},
		},
	);
}
