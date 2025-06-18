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