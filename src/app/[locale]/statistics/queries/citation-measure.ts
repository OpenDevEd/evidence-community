import { EXCLUDED_ITEM_TYPES } from "@/constants/items";
import { asc, eq, sql, type SQL } from "drizzle-orm";

import type { Database } from "@/db";
import { sourceConnection } from "@/db/schema/source";
import { itemCitationMetric } from "@/db/schema/tables/itemCitationMetric";
import { sourceDisplayLabel } from "@/lib/admin/source-label";

const LIBRARY_CITATION_MEASURE_KEY = "library";

export type CitationMeasure =
	| { kind: "library"; key: typeof LIBRARY_CITATION_MEASURE_KEY }
	| { kind: "source"; key: string; sourceConnectionKey: string };

export type CitationMeasureOption = {
	key: string;
	kind: CitationMeasure["kind"];
	sourceLabel?: string;
};

/**
 * How often a publication is cited. Under the library's own measure only citations a reader can see count: the citing
 * record must be a publication in the library, not a note or attachment, not deleted and not hidden by a hidden tag.
 */
export function citationCountForItem(measure: CitationMeasure, hiddenTags: readonly string[]): SQL<number> {
	if (measure.kind === "source") {
		return sql<number>`coalesce((
			select metric."citedByCount"
			from "itemCitationMetric" metric
			where metric."itemKey" = "item"."key"
				and metric."sourceConnectionKey" = ${measure.sourceConnectionKey}
		), 0)`;
	}

	return sql<number>`coalesce((
		select count(distinct citation_link."fromKey")::integer
		from "itemLink" citation_link
		inner join "item" citation_source
			on citation_source."key" = citation_link."fromKey"
		where citation_link."toKey" = "item"."key"
			and citation_link."kind" = 'cites'
			and citation_source."deleted" = 0
			and coalesce(citation_source."parentItem", '') = ''
			and citation_source."itemType"::text not in (${sql.join(EXCLUDED_ITEM_TYPES.map((type) => sql`${type}`), sql`, `)})
			${hiddenTags.length ? sql`and not exists (
				select 1 from "itemToTag" citing_tag
				where citing_tag."itemKey" = citation_source."key"
					and lower(citing_tag."tagName") in (${sql.join(hiddenTags.map((tag) => sql`${tag.toLowerCase()}`), sql`, `)})
			)` : sql``}
	), 0)`;
}

export async function resolveCitationMeasure(
	db: Database,
	requestedKey: string | undefined,
): Promise<{
	measure: CitationMeasure;
	options: CitationMeasureOption[];
}> {
	const rows = await db
		.selectDistinct({
			key: sourceConnection.key,
			provider: sourceConnection.provider,
			displayName: sourceConnection.displayName,
			externalScopeKey: sourceConnection.externalScopeKey,
		})
		.from(itemCitationMetric)
		.innerJoin(
			sourceConnection,
			eq(sourceConnection.key, itemCitationMetric.sourceConnectionKey),
		)
		.orderBy(asc(sourceConnection.provider), asc(sourceConnection.key));

	const options: CitationMeasureOption[] = [
		{ key: LIBRARY_CITATION_MEASURE_KEY, kind: "library" },
		...rows.map((row) => ({
			key: `source:${row.key}`,
			kind: "source" as const,
			sourceLabel: sourceDisplayLabel(row),
		})),
	];
	const selected = options.find((option) => option.key === requestedKey);
	if (!selected || selected.kind === "library") {
		return {
			measure: { kind: "library", key: LIBRARY_CITATION_MEASURE_KEY },
			options,
		};
	}
	return {
		measure: {
			kind: "source",
			key: selected.key,
			sourceConnectionKey: selected.key.slice("source:".length),
		},
		options,
	};
}
