import "server-only";

import { eq } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getDatabaseForConfig } from "@/db";
import { itemRedirect } from "@/db/schema/tables/itemRedirect";

/** How long a page waits for a redirect lookup before it shows the record under the key it asked for. */
const ITEM_REDIRECT_LOOKUP_TIMEOUT_MS = 350;

/** The key an old record key now redirects to, or null when it has none. Rejects when the lookup takes too long. */
export async function readItemRedirect(
	config: Pick<LibraryServerConfig, "revision" | "services" | "updatedAt">,
	fromKey: string,
): Promise<string | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error("Redirect lookup timeout")), ITEM_REDIRECT_LOOKUP_TIMEOUT_MS);
	});
	const lookup = (async () => {
		const database = await getDatabaseForConfig(config);
		const [row] = await database
			.select({ toKey: itemRedirect.toKey })
			.from(itemRedirect)
			.where(eq(itemRedirect.fromKey, fromKey))
			.limit(1);
		return row?.toKey ?? null;
	})();
	try {
		return await Promise.race([lookup, timeout]);
	} finally {
		clearTimeout(timer);
	}
}
