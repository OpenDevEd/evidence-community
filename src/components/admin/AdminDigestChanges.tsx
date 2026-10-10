// MOCK: an edition's text marked up against the text AI wrote, so a reviewer sees what a person changed.
import { Fragment, type ReactNode } from "react";

import { CHIP } from "./AdminDigestEditor";

type Part = { text: string; kind: "same" | "added" | "removed" };

// A citation and a bold run each count as one word, so a swapped citation shows as one change.
const TOKEN = /(?:\[[^\]]*\]\(\/lib\/[A-Z0-9]{8}\)|\*\*[^*\n]+\*\*|\S+?(?=\s|\[|$))[ \t]*|\n+/g;
const word = (token: string) => token.trimEnd();
// A word both texts have keeps the space after it from whichever has one, so a removed run never touches the word before it.
const same = (before: string, after: string): Part => ({ text: before.length > after.length ? before : after, kind: "same" });

/** The words of `after`, with the ones `before` lacks marked added and the ones only `before` has marked removed. */
export function changesBetween(before: string, after: string): Part[] {
	const a = before.trim().match(TOKEN) ?? [];
	const b = after.trim().match(TOKEN) ?? [];
	let start = 0;
	while (start < a.length && start < b.length && word(a[start]!) === word(b[start]!)) start++;
	let end = 0;
	while (end < a.length - start && end < b.length - start && word(a[a.length - 1 - end]!) === word(b[b.length - 1 - end]!)) end++;
	const x = a.slice(start, a.length - end).map(word);
	const y = b.slice(start, b.length - end).map(word);
	// ponytail: the longest common run of words, in a table of both lengths multiplied. Fine for a digest once the
	// unchanged start and end are cut; the `diff` package if a text ever has tens of thousands of changed words.
	const width = y.length + 1;
	const common = new Uint16Array((x.length + 1) * width);
	for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) {
		common[i * width + j] = x[i] === y[j] ? common[(i + 1) * width + j + 1]! + 1 : Math.max(common[(i + 1) * width + j]!, common[i * width + j + 1]!);
	}
	const parts = b.slice(0, start).map((token, index) => same(a[index]!, token));
	let i = 0;
	let j = 0;
	while (i < x.length || j < y.length) {
		if (i < x.length && j < y.length && x[i] === y[j]) { parts.push(same(a[start + i]!, b[start + j]!)); i++; j++; }
		else if (i < x.length && (j === y.length || common[(i + 1) * width + j]! >= common[i * width + j + 1]!)) parts.push({ text: a[start + i++]!, kind: "removed" });
		else parts.push({ text: b[start + j++]!, kind: "added" });
	}
	return [...parts, ...b.slice(b.length - end).map((token, index) => same(a[a.length - end + index]!, token))];
}

/** How many separate edits there are: a run of added and removed words is one. */
export const editCount = (parts: Part[]) => parts.filter((part, index) => part.kind !== "same" && (parts[index - 1]?.kind ?? "same") === "same").length;

export const ADDED = "rounded-sm bg-emerald-500/15 text-emerald-900 no-underline dark:text-emerald-200";
export const REMOVED = "rounded-sm bg-red-500/10 text-red-900/70 line-through dark:text-red-200/70";

function piece(part: Part, index: number) {
	const citation = /^\[([^\]]*)\]\([^)]*\)(\s*)$/.exec(part.text);
	const bold = /^\*\*([^*]+)\*\*(\s*)$/.exec(part.text);
	const body: ReactNode = citation ? <><span className={CHIP}>{citation[1]}</span>{citation[2]}</> : bold ? <><strong className="font-semibold">{bold[1]}</strong>{bold[2]}</> : part.text;
	return part.kind === "same" ? <Fragment key={index}>{body}</Fragment> : part.kind === "added" ? <ins key={index} className={ADDED}>{body}</ins> : <del key={index} className={REMOVED}>{body}</del>;
}

/** One line of text, such as the title. */
export function ChangedLine({ parts }: { parts: Part[] }) {
	return <>{parts.map(piece)}</>;
}

/** The digest's body. A paragraph nobody touched is dimmed, so the changed ones stand out. */
export function ChangedText({ parts }: { parts: Part[] }) {
	const blocks: Part[][] = [[]];
	for (const part of parts) {
		if (part.text.startsWith("\n")) blocks.push([]);
		else blocks.at(-1)!.push(part);
	}
	return <div className="text-[15px] leading-7">
		{blocks.filter((block) => block.length).map((block, index) => {
			const heading = word(block[0]!.text) === "##";
			const untouched = block.every((part) => part.kind === "same") ? "text-black/45 dark:text-white/45" : "";
			return heading
				? <h2 key={index} className={`mb-3 mt-9 border-b border-black/15 pb-1.5 text-xl font-semibold first:mt-0 dark:border-white/15 ${untouched}`}>{block.slice(1).map(piece)}</h2>
				: <p key={index} className={`mb-4 ${untouched}`}>{block.map(piece)}</p>;
		})}
	</div>;
}
