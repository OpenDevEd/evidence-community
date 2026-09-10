import type { NextRequest } from "next/server";
import { getDatabase } from "@/db";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { handleAdminJson, readAdminJson } from "@/lib/admin/http";
import {
	getItemPublishingChoice,
	setItemPublishingChoice,
} from "@/lib/admin/review-service";

type Context = { params: Promise<{ key: string }> };
export async function GET(request: NextRequest, { params }: Context) {
	const { key } = await params;
	return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async () =>
		getItemPublishingChoice(await getDatabase(), key),
	);
}
export function PUT(request: NextRequest, { params }: Context) {
	return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async () => {
		const [{ key }, db, body] = await Promise.all([
			params,
			getDatabase(),
			readAdminJson(request),
		]);
		await setItemPublishingChoice(db, key, body);
		return getItemPublishingChoice(db, key);
	});
}
