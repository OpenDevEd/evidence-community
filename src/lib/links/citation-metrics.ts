import { asc, eq, inArray } from "drizzle-orm";
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

export async function getSourceCitationMetricsForKeys(
	db: Pick<Executor, "select">,
	itemKeys: readonly string[],
): Promise<Map<string, SourceCitationMetric[]>> {
	if (itemKeys.length === 0) return new Map();
	const rows = await db
		.select({
			itemKey: itemCitationMetric.itemKey,
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
		.where(inArray(itemCitationMetric.itemKey, [...itemKeys]))
		.orderBy(
			asc(itemCitationMetric.itemKey),
			asc(sourceConnection.provider),
			asc(sourceConnection.key),
		);

	const metricsByItem = new Map<string, SourceCitationMetric[]>();
	for (const row of rows) {
		const metrics = metricsByItem.get(row.itemKey) ?? [];
		metrics.push({
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
		});
		metricsByItem.set(row.itemKey, metrics);
	}
	return metricsByItem;
}

export async function getSourceCitationMetrics(
	db: Executor,
	itemKey: string,
): Promise<SourceCitationMetric[]> {
	return (
		(await getSourceCitationMetricsForKeys(db, [itemKey])).get(itemKey) ??
		[]
	);
}
