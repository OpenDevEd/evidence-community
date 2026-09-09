import { writebackRoute } from "@/lib/admin/writeback-context";

import { retryAdminSourceWriteback } from "@/lib/admin/source-writeback-service";

export const POST = writebackRoute(async ({key, sourceKey, database, config}) => {
		return {
			status: await retryAdminSourceWriteback(
				database,
				key,
				sourceKey,
				config,
			),
		};
});
