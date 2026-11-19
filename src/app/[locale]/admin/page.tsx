import { getZoteroSchema } from "@opendeved/evidence-library-core/zotero-schema";
import { defaultFileAccessOf } from "@/lib/licences";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { SWRConfig } from "swr";

import { AdminNoAccess } from "@/components/admin/AdminNoAccess";
import { AdminSessionProvider } from "@/components/admin/AdminSessionProvider";
import AdminWorkbench from "@/components/admin/AdminWorkbench";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase } from "@/db";
import {
	buildRuntimeLocalizedPathname,
	type PlatformLocale,
} from "@/i18n/runtime";
import { ADMIN_CONTENT_PERMISSION, authorizeAdminRequest } from "@/lib/admin/access";
import { getAdminCollectionChildrenPage } from "@/lib/admin/collection-catalog-service";
import { ADMIN_COLLECTION_PAGE_SIZE, NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { PDF_IMPORT_KEY } from "@/lib/admin/item-import-contract";
import { getAdminLibrarySnapshot } from "@/lib/admin/library-query-service";
import { pdfImportStatus } from "@/lib/admin/pdf-import-service";
import { ADMIN_HOME_PATH, buildAdminSignInPath } from "@/lib/runtime-routing";

/** The library's source settings on OpenScholar's page for this library. */
function openScholarConfigurationHref(libraryUrl: string) {
	const url = new URL(libraryUrl);
	url.pathname = `${url.pathname.replace(/\/$/u, "")}/configuration`;
	url.search = "?section=sources";
	url.hash = "";
	return url.toString();
}

/**
 * The sources, the first page of the library's own collections and the library's PDF import as the page is served, so
 * the sidebar and the Import button are whole at first paint. When one cannot be read the admin still opens, and reads
 * it again.
 */
async function sidebarWithThePage() {
	// One promise for the database, so a library whose database cannot be reached falls back like a failed read.
	const database = getDatabase();
	const [initialLibrary, firstCollections, pdfImport] = await Promise.all([
		database.then(getAdminLibrarySnapshot).catch((error: unknown) => {
			console.error("The admin's sources were not read with the page", error);
			return { sources: [] };
		}),
		database.then((db) => getAdminCollectionChildrenPage(db, { cursor: null, pageSize: ADMIN_COLLECTION_PAGE_SIZE, parentCollection: null, sourceConnectionKey: NATIVE_SOURCE_CONNECTION_KEY })).catch((error: unknown) => {
			console.error("The admin's collections were not read with the page", error);
			return null;
		}),
		database.then(pdfImportStatus).catch((error: unknown) => {
			console.error("The admin's PDF import was not read with the page", error);
			return null;
		}),
	]);
	// The import as SWR starts from, so the Import button shows its state at first paint.
	return { initialLibrary, firstCollections, fallback: pdfImport ? { [PDF_IMPORT_KEY]: pdfImport } : {} };
}

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
	if (authorization.status === "unavailable") throw new Error("Openscholar access verification is temporarily unavailable");
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

	const { initialLibrary, firstCollections, fallback } = await sidebarWithThePage();
	const definitions = getZoteroSchema().itemTypes.map((definition) => ({
		creatorTypes: definition.creatorTypes,
		fields: definition.fields,
		itemType: definition.itemType,
	}));

	return (
		<AdminSessionProvider session={{ role: authorization.session.role, userId: authorization.session.clerkUserId, name: authorization.session.name, image: authorization.session.image, doiProviders: { crossref: config.services.publication.crossref.enabled, zenodo: config.services.publication.zenodo.enabled }, defaultLicence: config.services.publication.zenodo.license, defaultFileAccess: defaultFileAccessOf(config.services.publication.zenodo.defaultFileAccess) }}>
		<SWRConfig value={{ fallback }}>
			<AdminWorkbench
				configurationHref={openScholarConfigurationHref(config.authentication.openScholar.libraryUrl)}
				definitions={definitions}
				initialCollections={firstCollections}
				initialLibrary={initialLibrary}
			/>
		</SWRConfig>
		</AdminSessionProvider>
	);
}
