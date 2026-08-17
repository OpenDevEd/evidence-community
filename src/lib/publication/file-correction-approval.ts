import type { ZenodoFileCorrectionApproval } from "@opendeved/doi-sync-core";

import type { zenodoFileCorrectionApproval } from "@/db/schema/publication";

type ApprovalRow = typeof zenodoFileCorrectionApproval.$inferSelect;

export function fileCorrectionApprovalFromRow(
	row: ApprovalRow,
): ZenodoFileCorrectionApproval {
	return {
		id: String(row.id),
		kind: "minor_correction",
		recordKey: row.itemKey,
		doi: row.doi,
		fileManifestHash: row.fileManifestHash,
		approvedAt: row.approvedAt,
	};
}
