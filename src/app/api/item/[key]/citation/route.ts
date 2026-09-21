import { getCitationsForItemKey } from "@/lib/citations";
import type { CitationResponse } from "@/lib/citation-formats";
import { getRuntimeRequestLocale } from "@/i18n/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, context: { params: Promise<{ key: string }> }) {
	const { key } = await context.params;
	const locale = await getRuntimeRequestLocale(request);
	const headers = { "Cache-Control": "no-store", Vary: "Accept-Language" };
	try {
		const citations = await getCitationsForItemKey(key, locale);
		return NextResponse.json<CitationResponse>({ citations }, { headers });
	} catch (error) {
		console.error("Public citation read failed", { key, error });
		return NextResponse.json({ error: "Unable to load citations" }, { status: 503, headers });
	}
}
