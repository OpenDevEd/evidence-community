import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { syncRuntimeFeatureFlags } from "@/lib/runtime-feature-flags";

const AUTH_SCHEME = "Bearer ";
const SYNC_SECRET_HEADER = "x-sync-secret";

function isSecretMatch(expected: string | undefined, provided: string | null) {
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

function isAuthorized(request: Request): boolean {
	const authorization = request.headers.get("authorization");
	const cronSecret = authorization?.startsWith(AUTH_SCHEME)
		? authorization.slice(AUTH_SCHEME.length)
		: null;

	if (isSecretMatch(process.env.CRON_SECRET, cronSecret)) {
		return true;
	}

	if (
		isSecretMatch(
			process.env.FEATURE_FLAGS_SYNC_SECRET,
			request.headers.get(SYNC_SECRET_HEADER)
		)
	) {
		return true;
	}

	return false;
}

async function syncFeatureFlags(request: Request) {
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

export async function GET(request: Request) {
	return syncFeatureFlags(request);
}

export async function POST(request: Request) {
	return syncFeatureFlags(request);
}
