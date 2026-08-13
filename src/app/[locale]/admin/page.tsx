import { getZoteroSchema } from "@opendeved/evidence-library-core/zotero-schema";
import { cookies } from "next/headers";
import { connection } from "next/server";

import AdminWorkbench from "@/components/admin/AdminWorkbench";
import { AdminLogin } from "@/components/admin/AdminLogin";
import {
	adminSessionCookieName,
	isAdminSessionAuthorized,
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
	if (
		!(await isAdminSessionAuthorized(
			cookieStore.get(adminSessionCookieName())?.value,
		))
	) {
		return <AdminLogin status={resolvedSearchParams.login} />;
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
		<>
			<AdminWorkbench
				definitions={definitions}
				initialFilters={parseAdminItemViewFilters(urlSearchParams)}
			/>
			<form
				action="/api/admin/session/logout"
				className="fixed right-16 top-3 z-50"
				method="post"
			>
				<button
					className="min-h-10 rounded-xl px-3 text-sm font-semibold"
					type="submit"
				>
					Log out
				</button>
			</form>
		</>
	);
}
