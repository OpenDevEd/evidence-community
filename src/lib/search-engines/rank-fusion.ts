/** Elastic's reciprocal rank fusion constant: how much a first place outweighs a tenth. */
const RANK_CONSTANT = 60;

/**
 * Keys from several ranked lists in one order, by weighted reciprocal rank fusion as Elasticsearch's RRF scores them:
 * each list adds `weight / (60 + rank)` for a key it holds, counting ranks from 1 (OpenDevEd/new-el#720). Elasticsearch's
 * own fusion needs a paid licence. Keys that score the same keep the order they first appeared in.
 */
export function fuseRanks(lists: ReadonlyArray<{ weight: number; keys: readonly string[] }>) {
	const scores = new Map<string, number>();
	for (const { weight, keys } of lists) {
		keys.forEach((key, index) => scores.set(key, (scores.get(key) ?? 0) + weight / (RANK_CONSTANT + index + 1)));
	}
	return [...scores.keys()].sort((left, right) => scores.get(right)! - scores.get(left)!);
}
