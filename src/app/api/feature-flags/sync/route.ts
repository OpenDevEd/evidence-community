import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { syncRuntimeFeatureFlags } from "@/lib/runtime-feature-flags";

const SYNC_SECRET_HEADER = "x-sync-secret";

function isAuthorized(request: Request): boolean {
	const expected = process.env.FEATURE_FLAGS_SYNC_SECRET;
	const provided = request.headers.get(SYNC_SECRET_HEADER);

	if (!expected || !provided) {
		return false;
	}

	const expectedBuffer = Buffer.from(expected);
	const providedBuffer = Buffer.from(provided);

	return (
		expectedBuffer.length === providedBuffer.length &&
		timingSafeEqual(expectedBuffer, providedBuffer)
	);
}

export async function POST(request: Request) {
	if (!isAuthorized(request)) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const result = await syncRuntimeFeatureFlags();

	if (result.refreshed) {
		revalidateTag("status", "max");
	}

	return NextResponse.json({
		reason: result.reason,
		refreshed: result.refreshed,
		count: Object.keys(result.flags).length,
	});
}
