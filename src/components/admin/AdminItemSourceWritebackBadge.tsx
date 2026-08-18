"use client";

import { AdminSourceWritebackStatus } from "./AdminSourceWritebackStatus";
import { useAdminSourceWriteback } from "./useAdminSourceWriteback";

/** One writeback status badge for one record and one source. */
export function AdminItemSourceWritebackBadge({
	itemKey,
	revision,
	sourceKey,
	sourceLabel,
}: {
	itemKey: string;
	revision: number | null;
	sourceKey: string;
	sourceLabel: string;
}) {
	const writeback = useAdminSourceWriteback(itemKey, sourceKey, revision);
	return (
		<AdminSourceWritebackStatus
			error={writeback.error}
			loading={writeback.loading}
			onRefresh={() => void writeback.refresh()}
			onResolve={(choice) => void writeback.resolve(choice)}
			onRetry={() => void writeback.retry()}
			retrying={writeback.retrying}
			sourceLabel={sourceLabel}
			status={writeback.status}
		/>
	);
}
