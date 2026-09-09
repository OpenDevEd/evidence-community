import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { buildAdminPublicationView } from "./admin-publication-view-service";

export async function runAdminPublicationAction<T>(
 key: string,
 action: (database: Database, key: string, config: LibraryServerConfig) => Promise<T>,
) {
 const config = await getLibraryConfig();
 const activation = await action(await getDatabaseForConfig(config), key, config);
 return {activation, publication: await buildAdminPublicationView(key)};
}
