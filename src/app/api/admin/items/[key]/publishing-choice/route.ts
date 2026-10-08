import type { NextRequest } from "next/server";
import { getDatabaseForConfig } from "@/db";
import { getLibraryConfig } from "@/config/library-config/server";
import { ADMIN_CONTENT_PERMISSION } from "@/lib/admin/access";
import { handleAdminJson, readAdminJson } from "@/lib/admin/http";
import {
	getItemPublishingChoice,
	setItemPublishingChoice,
} from "@/lib/admin/review-service";

type Context = { params: Promise<{ key: string }> };
export async function GET(request: NextRequest, { params }: Context) {
	const { key } = await params;
	return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async () => {
		const config = await getLibraryConfig();
		return getItemPublishingChoice(await getDatabaseForConfig(config), key, config);
	});
}
export function PUT(request: NextRequest, { params }: Context) {
	return handleAdminJson(request, ADMIN_CONTENT_PERMISSION, async () => {
		const [{ key }, config, body] = await Promise.all([
			params,
			getLibraryConfig(),
			readAdminJson(request),
		]);
		const db = await getDatabaseForConfig(config);
		await setItemPublishingChoice(db, key, body, config);
		return getItemPublishingChoice(db, key, config);
	});
}
