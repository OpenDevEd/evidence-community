import { getZoteroSchema } from "@opendeved/evidence-library-core/zotero-schema";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { AdminNoAccess } from "@/components/admin/AdminNoAccess";
import { AdminSessionProvider } from "@/components/admin/AdminSessionProvider";
import AdminWorkbench from "@/components/admin/AdminWorkbench";
import { getLibraryConfig } from "@/config/library-config/server";
import {
	buildRuntimeLocalizedPathname,
	type PlatformLocale,
} from "@/i18n/runtime";
import { ADMIN_CONTENT_PERMISSION, authorizeAdminRequest } from "@/lib/admin/access";
import { parseAdminItemViewFilters } from "@/lib/admin/item-filter-state";
import { ADMIN_HOME_PATH, buildAdminSignInPath } from "@/lib/runtime-routing";

/** The library's source settings on OpenScholar's page for this library. */
function openScholarConfigurationHref(libraryUrl: string) {
	const url = new URL(libraryUrl);
	url.pathname = `${url.pathname.replace(/\/$/u, "")}/configuration`;
	url.search = "?section=sources";
	url.hash = "";
	return url.toString();
}

// Waits for the admin's access check instead of showing a loading state, so nobody sees the workbench before it.
// Next.js reads this route export. Fallow does not recognize it yet.
// fallow-ignore-next-line unused-export
export const instant = false;

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

	const config = await getLibraryConfig();
	const authorization = await authorizeAdminRequest(await headers(), ADMIN_CONTENT_PERMISSION, config);
	if (authorization.status === "unavailable") throw new Error("OpenScholar access verification is temporarily unavailable");
	if (authorization.status === "no_access") return <AdminNoAccess organisationName={authorization.organisationName} />;
	if (authorization.status !== "authorized") {
		// The proxy sends a request without a session cookie to sign-in first;
		// this covers a cookie whose session has ended.
		const { locale } = await params;
		const { localization } = config;
		const pathname = buildRuntimeLocalizedPathname(
			ADMIN_HOME_PATH,
			locale,
			localization.defaultLocale,
		);
		const query = urlSearchParams.toString();
		redirect(buildAdminSignInPath(query ? `${pathname}?${query}` : pathname));
	}

	const definitions = getZoteroSchema().itemTypes.map((definition) => ({
		creatorTypes: definition.creatorTypes,
		fields: definition.fields,
		itemType: definition.itemType,
	}));

	return (
		<AdminSessionProvider session={{ role: authorization.session.role, userId: authorization.session.clerkUserId }}>
		<AdminWorkbench
			configurationHref={openScholarConfigurationHref(config.authentication.openScholar.libraryUrl)}
			definitions={definitions}
			initialFilters={parseAdminItemViewFilters(urlSearchParams)}
		/>
		</AdminSessionProvider>
	);
}
