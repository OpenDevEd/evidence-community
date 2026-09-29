import { asc, eq, inArray } from "drizzle-orm";
import type { SourceProvider } from "@opendeved/evidence-library-core";

import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { sourceConnection } from "@/db/schema/source";
import { itemCitationMetric } from "@/db/schema/tables/itemCitationMetric";
import { sourceDisplayLabel, sourceProviderName } from "@/lib/admin/source-label";
import { isOpenAlexWorkProvider } from "@/lib/source-providers";

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
		const openAlex = isOpenAlexWorkProvider(row.provider);
		const metric: SourceCitationMetric = {
			sourceConnectionKey: row.sourceConnectionKey,
			// These are OpenAlex's own counts, whichever search imported the work.
			sourceLabel: openAlex
				? sourceProviderName("openalex")
				: sourceDisplayLabel({
						key: row.sourceConnectionKey,
						provider: row.provider,
						displayName: row.displayName,
						externalScopeKey: row.externalScopeKey,
					}),
			provider: row.provider,
			citedByCount: row.citedByCount,
			referencedWorksCount: row.referencedWorksCount,
			observedAt: row.observedAt.toISOString(),
		};
		// Overlapping OpenAlex searches report the same work: keep the newest count.
		const shown = openAlex
			? metrics.findIndex((existing) => isOpenAlexWorkProvider(existing.provider))
			: -1;
		if (shown === -1) metrics.push(metric);
		else if (metric.observedAt > metrics[shown]!.observedAt) metrics[shown] = metric;
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
