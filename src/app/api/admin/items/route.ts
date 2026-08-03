import { connection, NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import {
	ADMIN_RESPONSE_HEADERS,
	adminErrorResponse,
	requireAdminBypass,
} from "@/lib/admin/http";
import { getAdminItemListPage } from "@/lib/admin/item-list-query";
import { parseAdminItemListRequest } from "@/lib/admin/item-list-contract";
import { AdminValidationError } from "@/lib/admin/errors";

function jsonParameter(searchParams: URLSearchParams, name: string) {
	const value = searchParams.get(name);
	if (!value) return undefined;
	try {
		return JSON.parse(value);
	} catch (error) {
		throw new AdminValidationError(
			"The record-list filters are invalid. Clear the filters and try again.",
			{ [name]: "Clear this filter and choose it again." },
			{ cause: error },
		);
	}
}

export async function GET(request: NextRequest) {
	await connection();

	const denied = requireAdminBypass();
	if (denied) return denied;

	try {
		const { searchParams } = request.nextUrl;
		const listRequest = parseAdminItemListRequest({
			cursor: searchParams.get("cursor"),
			filters: jsonParameter(searchParams, "filters"),
			pageSize: searchParams.get("pageSize") ?? undefined,
			requestedColumns: jsonParameter(
				searchParams,
				"requestedColumns",
			),
			search: searchParams.get("search") ?? undefined,
			sorting: jsonParameter(searchParams, "sorting"),
		});
		return NextResponse.json(
			await getAdminItemListPage(await getDatabase(), listRequest),
			{ headers: ADMIN_RESPONSE_HEADERS },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
