import "server-only";
import { getDatabase } from "@/db";
import { getLibraryConfig } from "@/config/library-config/server";
import { resolveTopicNodes as resolve, resolveTopicAncestry as ancestry } from "./catalog";

export async function resolveTopicNodes(ids: readonly string[]) {
  const [database, config] = await Promise.all([getDatabase(), getLibraryConfig()]);
  return resolve(ids, {database, config});
}
export async function resolveTopicAncestry(ids: readonly string[]) {
  const [database, config] = await Promise.all([getDatabase(), getLibraryConfig()]);
  return ancestry(ids, {database, config});
}
