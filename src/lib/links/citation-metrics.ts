import { asc, eq } from "drizzle-orm";
import type { SourceProvider } from "@opendeved/evidence-library-core";

import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { sourceConnection } from "@/db/schema/source";
import { itemCitationMetric } from "@/db/schema/tables/itemCitationMetric";
import { sourceDisplayLabel } from "@/lib/admin/source-label";

type Executor = Database | DatabaseTransaction;

export type SourceCitationMetric = {
	sourceConnectionKey: string;
	sourceLabel: string;
	provider: SourceProvider;
	citedByCount: number | null;
	referencedWorksCount: number | null;
	observedAt: string;
};

export async function getSourceCitationMetrics(
	db: Executor,
	itemKey: string,
): Promise<SourceCitationMetric[]> {
	const rows = await db
		.select({
			sourceConnectionKey: itemCitationMetric.sourceConnectionKey,
			provider: sourceConnection.provider,
			displayName: sourceConnection.displayName,
			externalScopeKey: sourceConnection.externalScopeKey,
			citedByCount: itemCitationMetric.citedByCount,
			referencedWorksCount: itemCitationMetric.referencedWorksCount,
			observedAt: itemCitationMetric.observedAt,
		})
		.from(itemCitationMetric)
		.innerJoin(
			sourceConnection,
			eq(sourceConnection.key, itemCitationMetric.sourceConnectionKey),
		)
		.where(eq(itemCitationMetric.itemKey, itemKey))
		.orderBy(asc(sourceConnection.provider), asc(sourceConnection.key));

	return rows.map((row) => ({
		sourceConnectionKey: row.sourceConnectionKey,
		sourceLabel: sourceDisplayLabel({
			key: row.sourceConnectionKey,
			provider: row.provider,
			displayName: row.displayName,
			externalScopeKey: row.externalScopeKey,
		}),
		provider: row.provider,
		citedByCount: row.citedByCount,
		referencedWorksCount: row.referencedWorksCount,
		observedAt: row.observedAt.toISOString(),
	}));
}
