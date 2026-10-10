// What an edition's text looks like against the text AI wrote, word by word.

export type Part = { text: string; kind: "same" | "added" | "removed" };

// A citation and a bold run each count as one word, so a swapped citation shows as one change.
const TOKEN = /(?:\[[^\]]*\]\(\/lib\/[A-Z0-9]{8}\)|\*\*[^*\n]+\*\*|\S+?(?=\s|\[|$))[ \t]*|\n+/g;
const word = (token: string) => token.trimEnd();
// A word both texts have keeps the space after it from whichever has one, so a removed run never touches the word before it.
const same = (before: string, after: string): Part => ({ text: before.length > after.length ? before : after, kind: "same" });

/** How many words both texts share at their start and at their end. Most of a digest is untouched, so little is left between. */
function sharedEnds(a: string[], b: string[]) {
	let start = 0;
	while (start < a.length && start < b.length && word(a[start]!) === word(b[start]!)) start++;
	let end = 0;
	while (end < a.length - start && end < b.length - start && word(a[a.length - 1 - end]!) === word(b[b.length - 1 - end]!)) end++;
	return { start, end };
}

/**
 * For each pair of positions, the longest run of words the rest of both texts share.
 * ponytail: a table of both lengths multiplied, which `middle` caps. Fine for a digest once the unchanged start and
 * end are cut; the `diff` package if long texts with little in common ever need their shared words found.
 */
function sharedRuns(x: string[], y: string[]) {
	const width = y.length + 1;
	const runs = new Uint16Array((x.length + 1) * width);
	for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) {
		runs[i * width + j] = x[i] === y[j] ? runs[(i + 1) * width + j + 1]! + 1 : Math.max(runs[(i + 1) * width + j]!, runs[i * width + j + 1]!);
	}
	return (i: number, j: number) => runs[i * width + j]!;
}

// Two whole digests of ordinary length fit; the table for these many pairs of words takes 8 MB.
const MOST_PAIRS = 4_000_000;

/**
 * The changed middle of two texts as parts: a word both have, one only the first has, or one only the second has.
 * Removed words come before the ones that replace them. Two long texts with little in common are shown as one
 * replaced by the other, without looking for the words they share.
 */
function middle(a: string[], b: string[]): Part[] {
	if (a.length * b.length > MOST_PAIRS) return [...a.map((text): Part => ({ text, kind: "removed" })), ...b.map((text): Part => ({ text, kind: "added" }))];
	const [x, y] = [a.map(word), b.map(word)];
	const shared = sharedRuns(x, y);
	const parts: Part[] = [];
	let i = 0;
	let j = 0;
	while (i < x.length && j < y.length) {
		if (x[i] === y[j]) parts.push(same(a[i++]!, b[j++]!));
		else if (shared(i + 1, j) >= shared(i, j + 1)) parts.push({ text: a[i++]!, kind: "removed" });
		else parts.push({ text: b[j++]!, kind: "added" });
	}
	return [...parts, ...a.slice(i).map((text): Part => ({ text, kind: "removed" })), ...b.slice(j).map((text): Part => ({ text, kind: "added" }))];
}

/** The words of `after`, with the ones `before` lacks marked added and the ones only `before` has marked removed. */
export function changesBetween(before: string, after: string): Part[] {
	const a = before.trim().match(TOKEN) ?? [];
	const b = after.trim().match(TOKEN) ?? [];
	const { start, end } = sharedEnds(a, b);
	return [
		...b.slice(0, start).map((token, index) => same(a[index]!, token)),
		...middle(a.slice(start, a.length - end), b.slice(start, b.length - end)),
		...b.slice(b.length - end).map((token, index) => same(a[a.length - end + index]!, token)),
	];
}

/** How many separate edits there are: a run of added and removed words is one. */
export const editCount = (parts: Part[]) => parts.filter((part, index) => part.kind !== "same" && (parts[index - 1]?.kind ?? "same") === "same").length;
