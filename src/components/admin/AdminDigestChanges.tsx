// An edition's text marked up against the text AI wrote, so a reviewer sees what a person changed.
import { Fragment, type ReactNode } from "react";

import { CHIP } from "./AdminDigestEditor";

import { type Part } from "./digest-changes";

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
			const heading = block[0]!.text.trimEnd() === "##";
			const untouched = block.every((part) => part.kind === "same") ? "text-black/45 dark:text-white/45" : "";
			return heading
				? <h2 key={index} className={`mb-3 mt-9 border-b border-black/15 pb-1.5 text-xl font-semibold first:mt-0 dark:border-white/15 ${untouched}`}>{block.slice(1).map(piece)}</h2>
				: <p key={index} className={`mb-4 ${untouched}`}>{block.map(piece)}</p>;
		})}
	</div>;
}
