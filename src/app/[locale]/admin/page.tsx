import { getZoteroSchema } from "@opendeved/evidence-library-core/zotero-schema";
import { cookies } from "next/headers";
import { connection } from "next/server";

import { AdminAccess } from "@/components/admin/AdminAccess";
import AdminWorkbench from "@/components/admin/AdminWorkbench";
import {
	adminSessionCookieName,
	getAdminAccessConfig,
	getAdminSession,
} from "@/lib/admin/access";
import { parseAdminItemViewFilters } from "@/lib/admin/item-filter-state";

export default async function AdminPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	await connection();
	const resolvedSearchParams = await searchParams;
	const cookieStore = await cookies();
	const adminConfig = await getAdminAccessConfig();
	const session = await getAdminSession(
		cookieStore.get(adminSessionCookieName())?.value,
		adminConfig,
	);
	if (!session) {
		return <AdminAccess loginPageUrl={adminConfig.loginPageUrl} />;
	}
	const urlSearchParams = new URLSearchParams();
	for (const [key, value] of Object.entries(resolvedSearchParams)) {
		for (const entry of Array.isArray(value) ? value : [value]) {
			if (entry !== undefined) urlSearchParams.append(key, entry);
		}
	}

	const definitions = getZoteroSchema().itemTypes.map((definition) => ({
		creatorTypes: definition.creatorTypes,
		fields: definition.fields,
		itemType: definition.itemType,
	}));

	return (
		<AdminWorkbench
			definitions={definitions}
			initialFilters={parseAdminItemViewFilters(urlSearchParams)}
		/>
	);
}
