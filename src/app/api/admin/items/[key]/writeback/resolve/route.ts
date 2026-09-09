import { writebackRoute } from "@/lib/admin/writeback-context";

import {
	readAdminJson,
} from "@/lib/admin/http";
import { resolveAdminSourceWritebackConflict } from "@/lib/admin/source-writeback-service";
import { adminSearchIndexReceipt } from "@/lib/admin/search-index-contract";
import { adminWritebackResolveRequestSchema } from "@/lib/admin/writeback-request-contract";
import { createSourceWritebackRuntime } from "@/lib/source-writeback/runtime";

export const POST = writebackRoute(async ({key, sourceKey, database, config, request}) => {
		const { choice } = adminWritebackResolveRequestSchema.parse(
			await readAdminJson(request),
		);
		const { indexingRecords, status } =
			await resolveAdminSourceWritebackConflict(
				database,
				key,
				sourceKey,
				choice,
				config,
				{ ...createSourceWritebackRuntime(config), signal: request.signal },
			);
		return {
			indexingReceipts: indexingRecords.map((record) =>
				adminSearchIndexReceipt("item", record),
			),
			status,
		};
});
