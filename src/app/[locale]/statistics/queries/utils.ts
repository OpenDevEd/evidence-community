import { sql, type SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";

/**
 * The year of a stored date, read from its first four digits and never parsed, so no text in the column (such as
 * "forthcoming" or "2024-02-30") can make a statistics query fail. Null when the date does not start with a year.
 */
export function yearOf(date: AnyColumn | SQL) {
	return sql<number>`(case when ${date} ~ '^[0-9]{4}' then substring(${date} from 1 for 4)::int end)`;
}

// Helper function to calculate H-Index from citation counts
export function calculateHIndex(citationCounts: number[]): number {
	if (citationCounts.length === 0) return 0;
	
	// Sort citation counts in descending order
	const sortedCitations = citationCounts.sort((a, b) => b - a);
	
	let hIndex = 0;
	for (let i = 0; i < sortedCitations.length; i++) {
		// H-Index is the largest number h such that h publications have at least h citations each
		const currentRank = i + 1; // 1-indexed rank
		const currentCitations = sortedCitations[i];
		
		if (currentCitations >= currentRank) {
			hIndex = currentRank;
		} else {
			break;
		}
	}
	
	return hIndex;
} 