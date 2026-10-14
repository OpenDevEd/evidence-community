import "server-only";
import { authorCatalogRequest } from "./catalog-search";
import { parseAuthorCatalog, type AuthorProfile } from "./profiles";
import { NextResponse } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/http-cache";

export async function forwardAuthorProfileRequest(body: object, clerkUserId?: string) {
  const service = (await getLibraryConfig()).authentication.openScholar;
  const headers = {"Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL};
  try {
    const response = await authorCatalogRequest(service, {...body, ...(clerkUserId ? {clerkUserId} : {})});
    const result = await response.json();
    return NextResponse.json({...result, profileBaseUrl: new URL(service.libraryUrl).origin}, {status: response.status, headers});
  } catch (error) {
    console.error("Author profile catalog request failed", {libraryId: service.libraryId, error});
    return NextResponse.json({error: "Author profiles are unavailable. Try again shortly."}, {status: 503, headers});
  }
}

/** Profiles by id, in batches of 100; none when the catalog is unavailable, so callers keep the names they have. */
export async function readAuthorProfiles(ids: string[]): Promise<AuthorProfile[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const batches = await Promise.all(Array.from({length: Math.ceil(unique.length / 100)}, async (_, index) => {
    const response = await forwardAuthorProfileRequest({operation: "resolve", profileIds: unique.slice(index * 100, (index + 1) * 100)});
    return response.ok ? parseAuthorCatalog(await response.json()).profiles : [];
  }));
  return batches.flat();
}
