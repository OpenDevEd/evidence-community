import { connection } from "next/server";

import { AdminAccess } from "@/components/admin/AdminAccess";
import { getAdminAccessConfig } from "@/lib/admin/access";

export default async function AdminAccessErrorPage() {
	await connection();
	const config = await getAdminAccessConfig();
	return <AdminAccess error loginPageUrl={config.loginPageUrl} />;
}
