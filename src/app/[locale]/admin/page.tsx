import { getZoteroSchema } from "@opendeved/evidence-library-core/zotero-schema";
import { connection } from "next/server";
import { notFound } from "next/navigation";

import AdminWorkbench from "@/components/admin/AdminWorkbench";
import { isAdminBypassEnabled } from "@/lib/admin/access";
import { parseAdminItemViewFilters } from "@/lib/admin/item-filter-state";

export default async function AdminPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	await connection();
	if (!isAdminBypassEnabled()) notFound();
	const resolvedSearchParams = await searchParams;
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
