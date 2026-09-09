import type { NextRequest } from "next/server";
import { ADMIN_PUBLISH_PERMISSION } from "./access";
import { handleAdminJson } from "./http";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase } from "@/db";
import { readAdminSourceKey } from "./writeback-request-contract";

async function readWritebackContext(searchParams: URLSearchParams) {
 const sourceKey = readAdminSourceKey(searchParams);
 const [database, config] = await Promise.all([getDatabase(), getLibraryConfig()]);
 return {sourceKey, database, config};
}

export function writebackRoute(
 action: (context: Awaited<ReturnType<typeof readWritebackContext>> & {key: string; request: NextRequest}) => Promise<Record<string, unknown>>,
) {
 return (request: NextRequest, {params}: {params: Promise<{key: string}>}) => handleAdminJson(request, ADMIN_PUBLISH_PERMISSION, async () => {
  const {key} = await params;
  return action({...await readWritebackContext(request.nextUrl.searchParams), key, request});
 });
}
