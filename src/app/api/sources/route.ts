import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getCachedSources } from "../cache";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import type { SourcesGetResponse } from "./types";

export async function GET() {
	await headers();
	return NextResponse.json<SourcesGetResponse>(
		{ sources: await getCachedSources() },
		{ headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL } },
	);
}
