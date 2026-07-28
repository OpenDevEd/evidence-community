import { getDatabaseForConfig } from "@/db";
import { item } from "@/db/schema/tables/item";
import { desc, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { InstitutionsData } from "./types";
import { withMeilisearchCache } from "@/lib/cache-utils";
import { getLibraryConfig } from "@/config/library-config/server";
import type { LibraryServerConfig } from "@/config/library-config/schema";

// Helper function to calculate H-Index from citation counts
function calculateHIndex(citationCounts: number[]): number {
	if (citationCounts.length === 0) return 0;

	const sortedCitations = citationCounts.sort((a, b) => b - a);

	let hIndex = 0;
	for (let i = 0; i < sortedCitations.length; i++) {
		const currentRank = i + 1;
		const currentCitations = sortedCitations[i];

		if (currentCitations >= currentRank) {
			hIndex = currentRank;
		} else {
			break;
		}
	}

	return hIndex;
}

async function fetchInstitutionsData(
	config: LibraryServerConfig,
): Promise<InstitutionsData> {
	const db = await getDatabaseForConfig(config);
	const institutionStatsResult = await db
		.select({
			institution: sql<string>`institution_name`,
			countryCode: sql<string>`country_code`,
			itemCount: sql<number>`count(*)`,
			totalCitations: sql<number>`coalesce(sum(item_citations), 0)`,
			avgCitationsPerItem: sql<number>`coalesce(avg(item_citations), 0)`,
			citationCounts: sql<number[]>`array_agg(item_citations)`,
		})
		.from(sql`(
			SELECT DISTINCT
				institution_data->>'display_name' as institution_name,
				institution_data->>'country_code' as country_code,
				${item.key} as item_key,
				case
					when ${item.relations}::jsonb ? 'cited_by'
					then (${item.relations}::jsonb->>'cited_by')::int
					else 0
				end as item_citations
			FROM ${item},
			LATERAL unnest(${item.creators}) as creator_data,
			LATERAL jsonb_array_elements(creator_data->'institutions') as institution_data
			WHERE ${item.deleted} = 0
			AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
			AND ${item.creators} IS NOT NULL
			AND array_length(${item.creators}, 1) > 0
			AND creator_data ? 'institutions'
			AND jsonb_typeof(creator_data->'institutions') = 'array'
			AND jsonb_array_length(creator_data->'institutions') > 0
			AND institution_data ? 'display_name'
			AND institution_data->>'display_name' IS NOT NULL
			AND institution_data->>'display_name' != ''
		) as institution_items`)
		.where(sql`institution_name IS NOT NULL AND institution_name != ''`)
		.groupBy(sql`institution_name, country_code`)
		.orderBy(desc(sql`count(*)`));

	if (institutionStatsResult.length === 0) {
		throw new Error("No institutions found");
	}

	const topCountryCode = institutionStatsResult[0]?.countryCode;

	if (!topCountryCode) {
		throw new Error("No top country found");
	}

	const topCountryInstitutions = institutionStatsResult
		.filter(stat => stat.countryCode === topCountryCode)
		.map(stat => ({
			institution: stat.institution?.trim() || '',
			countryCode: stat.countryCode || '',
			itemCount: Number(stat.itemCount),
			totalCitations: Number(stat.totalCitations),
			avgCitationsPerItem: Number(stat.avgCitationsPerItem),
			hIndex: calculateHIndex(stat.citationCounts?.map(c => Number(c)) || [])
		}));

	return {
		topCountryCode,
		totalInstitutions: topCountryInstitutions.length,
		institutions: topCountryInstitutions
	};
}

export async function GET() {
	await headers();
	try {
		const config = await getLibraryConfig();
		const data = await withMeilisearchCache(
			config,
			`${config.revision}-institutions`,
			() => fetchInstitutionsData(config),
		);
		return NextResponse.json(data, {
			headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL },
		});
	} catch (error) {
		console.error("Error in institutions endpoint:", error);
		return NextResponse.json(
			{ error: "Failed to fetch institutions" },
			{ status: 500 }
		);
	}
}
