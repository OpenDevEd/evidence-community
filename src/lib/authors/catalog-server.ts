import "server-only";
import { NextResponse } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";
import { PRIVATE_NO_STORE_CACHE_CONTROL } from "@/lib/http-cache";

export async function forwardAuthorProfileRequest(body: object, clerkUserId?: string) {
  const service = (await getLibraryConfig()).authentication.openScholar;
  const headers = {"Cache-Control": PRIVATE_NO_STORE_CACHE_CONTROL};
  try {
    const response = await fetch(new URL("/api/v1/evidence-libraries/author-profiles", service.convexSiteUrl), {
      method: "POST",
      headers: {"Content-Type": "application/json", Authorization: `Bearer ${service.machineCredential}`},
      body: JSON.stringify({...body, libraryId: service.libraryId, ...(clerkUserId ? {clerkUserId} : {})}),
      signal: AbortSignal.timeout(10000), cache: "no-store",
    });
    const result = await response.json();
    return NextResponse.json({...result, profileBaseUrl: new URL(service.libraryUrl).origin}, {status: response.status, headers});
  } catch (error) {
    console.error("Author profile catalog request failed", {libraryId: service.libraryId, error});
    return NextResponse.json({error: "Author profiles are unavailable. Try again shortly."}, {status: 503, headers});
  }
}
