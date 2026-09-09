import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { prepareNotificationEditions, generateNotificationEdition } from "./editions";
import { deliverNotification } from "./delivery";

export async function runNotificationCycle(db: Database, config: LibraryServerConfig, signal?: AbortSignal) {
  try {
    await prepareNotificationEditions(db, config);
    if (!config.notifications.enabled) return;
    await generateNotificationEdition(db, config, signal);
    const deadline = Date.now() + 30_000;
    for (let sent = 0; sent < 25 && Date.now() < deadline && !signal?.aborted; sent++) {
      if (!(await deliverNotification(db, config))) break;
    }
    return null;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    console.error("Library notification cycle failed", error);
    return error instanceof Error ? error.message : String(error);
  }
}
