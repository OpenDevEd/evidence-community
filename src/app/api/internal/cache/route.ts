import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { clearCacheTags } from "@/lib/cache-clearing";
import { cacheInvalidationSchema, cacheInvalidationToken } from "@/lib/cache-invalidation";

const NO_STORE = { "Cache-Control": "no-store" };

// Only the web process's own stream reader calls this, over 127.0.0.1, with a token derived from the library secret.
export async function POST(request: NextRequest) {
	const expected = Buffer.from(`Bearer ${cacheInvalidationToken(await getLibraryConfig())}`);
	const given = Buffer.from(request.headers.get("authorization") ?? "");
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
		console.warn("[cache] Refused a clearing request without the token");
		return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
	}
	const parsed = cacheInvalidationSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid cache clear" }, { status: 400, headers: NO_STORE });
	}
	clearCacheTags(parsed.data);
	return NextResponse.json({ cleared: parsed.data.tags.length }, { headers: NO_STORE });
}
