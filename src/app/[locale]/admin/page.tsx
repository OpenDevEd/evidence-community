import { getZoteroSchema } from "@opendeved/evidence-library-core/zotero-schema";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { AdminSessionProvider } from "@/components/admin/AdminSessionProvider";
import AdminWorkbench from "@/components/admin/AdminWorkbench";
import { getLibraryConfig } from "@/config/library-config/server";
import {
	buildRuntimeLocalizedPathname,
	type PlatformLocale,
} from "@/i18n/runtime";
import {
	ADMIN_CONTENT_PERMISSION,
	adminSessionCookieName,
	authorizeAdminSession,
	getAdminAccessConfig,
	hasLiveView,
} from "@/lib/admin/access";
import { parseAdminItemViewFilters } from "@/lib/admin/item-filter-state";
import {
	ADMIN_HOME_PATH,
	buildAdminLoginPageUrl,
} from "@/lib/runtime-routing";

export default async function AdminPage({
	params,
	searchParams,
}: {
	params: Promise<{ locale: PlatformLocale }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	await connection();
	const resolvedSearchParams = await searchParams;
	const urlSearchParams = new URLSearchParams();
	for (const [key, value] of Object.entries(resolvedSearchParams)) {
		for (const entry of Array.isArray(value) ? value : [value]) {
			if (entry !== undefined) urlSearchParams.append(key, entry);
		}
	}

	const cookieStore = await cookies();
	const adminConfig = await getAdminAccessConfig();
	const authorization = await authorizeAdminSession(
		cookieStore.get(adminSessionCookieName())?.value,
		ADMIN_CONTENT_PERMISSION,
		adminConfig,
	);
	if (authorization.status === "unavailable") throw new Error("OpenScholar access verification is temporarily unavailable");
	if (authorization.status !== "authorized") {
		const { locale } = await params;
		const { localization } = await getLibraryConfig();
		const pathname = buildRuntimeLocalizedPathname(
			ADMIN_HOME_PATH,
			locale,
			localization.defaultLocale,
		);
		const query = urlSearchParams.toString();
		redirect(
			buildAdminLoginPageUrl(
				adminConfig.loginPageUrl,
				query ? `${pathname}?${query}` : pathname,
			),
		);
	}

	const definitions = getZoteroSchema().itemTypes.map((definition) => ({
		creatorTypes: definition.creatorTypes,
		fields: definition.fields,
		itemType: definition.itemType,
	}));

	return (
		<AdminSessionProvider session={{ role: authorization.session.role, userId: authorization.session.clerkUserId }}>
		<AdminWorkbench
			definitions={definitions}
			initialFilters={parseAdminItemViewFilters(urlSearchParams)}
			liveView={await hasLiveView()}
		/>
		</AdminSessionProvider>
	);
}
