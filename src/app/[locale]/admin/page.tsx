import { getZoteroSchema } from "@opendeved/evidence-library-core/zotero-schema";
import { connection } from "next/server";
import { notFound } from "next/navigation";

import AdminWorkbench from "@/components/admin/AdminWorkbench";
import { isAdminBypassEnabled } from "@/lib/admin/access";

export default async function AdminPage() {
	await connection();
	if (!isAdminBypassEnabled()) notFound();

	const definitions = getZoteroSchema().itemTypes.map((definition) => ({
		creatorTypes: definition.creatorTypes,
		fields: definition.fields,
		itemType: definition.itemType,
	}));

	return <AdminWorkbench definitions={definitions} />;
}
