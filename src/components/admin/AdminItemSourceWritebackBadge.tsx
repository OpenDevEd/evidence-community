"use client";

import { AdminSourceWritebackStatus } from "./AdminSourceWritebackStatus";
import { useAdminSourceWriteback } from "./useAdminSourceWriteback";

/** One writeback status badge for one record and one source. */
export function AdminItemSourceWritebackBadge({
	canLoadRemote,
	itemKey,
	revision,
	sourceKey,
	sourceLabel,
}: {
	/** Attachments and notes follow their parent; only the parent may load the source's copy. */
	canLoadRemote: boolean;
	itemKey: string;
	revision: number | null;
	sourceKey: string;
	sourceLabel: string;
}) {
	const writeback = useAdminSourceWriteback(itemKey, sourceKey, revision);
	return (
		<AdminSourceWritebackStatus
			canLoadRemote={canLoadRemote}
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
