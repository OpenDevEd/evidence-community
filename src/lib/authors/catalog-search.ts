import type { LibraryServerConfig } from "@/config/library-config/schema";

import { parseAuthorPage } from "./profiles";

type OpenScholarService = LibraryServerConfig["authentication"]["openScholar"];

/** A request to OpenScholar's author profile catalogue for this library. */
export function authorCatalogRequest(service: OpenScholarService, body: object, signal?: AbortSignal) {
	return fetch(new URL("/api/v1/evidence-libraries/author-profiles", service.convexSiteUrl), {
		body: JSON.stringify({ ...body, libraryId: service.libraryId }),
		cache: "no-store",
		headers: { Authorization: `Bearer ${service.machineCredential}`, "Content-Type": "application/json" },
		method: "POST",
		signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]),
	});
}

/** The library's author profiles matching a name, for linking a record's authors to them, searched as one of the library's people. */
export async function searchAuthorProfiles(service: OpenScholarService, { clerkUserId, search }: { clerkUserId: string; search: string }, signal?: AbortSignal) {
	const response = await authorCatalogRequest(service, { clerkUserId, operation: "search", paginationOpts: { cursor: null, numItems: 5 }, search }, signal);
	if (!response.ok) throw new Error(`OpenScholar's author profiles answered HTTP ${response.status}`);
	return parseAuthorPage({ ...(await response.json()), profileBaseUrl: new URL(service.libraryUrl).origin }).profiles;
}
