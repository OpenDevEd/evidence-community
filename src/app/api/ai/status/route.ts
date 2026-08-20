import { isOpenRouterConfigured } from "@/lib/ai/provider";
import { connection, NextResponse } from "next/server";

export async function GET() {
	await connection();
	return NextResponse.json(
		{ enabled: isOpenRouterConfigured() },
		{ headers: { "Cache-Control": "no-store" } },
	);
}
