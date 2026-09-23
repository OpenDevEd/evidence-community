import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getDatabaseForConfig } from "@/db";
import type { Database } from "@/db/database-schema";

// Runs one page part's read. Pages hand the returned promise to the client
// instead of awaiting it, so the page structure never waits for configuration
// or database access.
export async function readDigests<T>(locale: Promise<string>, read: (db: Database, config: LibraryServerConfig, locale: string) => Promise<T>) {
  const config = await getLibraryConfig();
  return read(await getDatabaseForConfig(config), config, await locale);
}
