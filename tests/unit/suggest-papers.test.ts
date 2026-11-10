import { afterEach, expect, it, vi } from "vitest";

import { findPapers, namesPaper, parse } from "@/components/features/suggest/papers";

afterEach(() => vi.unstubAllGlobals());

/** The community's answer to each request the dialog makes, and what it was asked. */
function community(answer: (body: Record<string, unknown>) => unknown) {
	const asked: Record<string, unknown>[] = [];
	vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
		asked.push(JSON.parse(String(init.body)));
		return Response.json(answer(asked.at(-1)!));
	}));
	return asked;
}

it("reads the papers a paste names, each once, and tells a search that is one paper from a title", () => {
	const named = parse("10.1000/One\nhttps://doi.org/10.1000/one  W2741809807 not-a-paper https://openalex.org/W2741809807");
	expect(named.map((paper) => paper.ref)).toEqual([{ doi: "10.1000/one" }, { openalexId: "W2741809807" }]);
	expect(namesPaper(" 10.1000/one ")).toBe(true);
	expect(namesPaper("the power of feedback")).toBe(false);
	// Two papers are a list for the dialog, not the one paper a search row offers.
	expect(namesPaper("10.1000/one W2741809807")).toBe(false);
});

it("looks up a pasted list as the papers it names, no more than the day allows, and a paper named twice is one row", async () => {
	const feedback = { title: "The Power of Feedback", authors: "Hattie, Timperley", year: 2007, openalexId: "W1", doi: "10.1000/one" };
	const asked = community(() => ({ results: [{ outcome: "found", paper: feedback }, { outcome: "found", paper: feedback }, { outcome: "existing", itemKey: "ABCD2345", paper: { ...feedback, title: "Here already", openalexId: "W3" } }] }));
	// Its DOI and its OpenAlex ID name the same work; a fourth paper is past what the reader may still suggest today.
	const { named, rows } = await findPapers("10.1000/one W1 W3 W4", 3);
	expect(asked).toEqual([{ preview: true, papers: [{ doi: "10.1000/one" }, { openalexId: "W1" }, { openalexId: "W3" }] }]);
	expect(named).toBe(true);
	expect(rows.map((row) => [row.key, row.state, row.title])).toEqual([["work:W1", "found", "The Power of Feedback"], ["work:W3", "here", "Here already"]]);
});

it("searches a text that names no paper as a title, and keeps each match under the paper it is", async () => {
	const asked = community(() => ({ matches: [
		{ outcome: "found", ref: { openalexId: "W1" }, paper: { title: "The Power of Feedback", authors: "Hattie", year: 2007, openalexId: "W1", doi: null } },
		{ outcome: "queued", ref: { doi: "10.1000/seven" }, paper: { title: "Known by its DOI alone", authors: "", year: null, openalexId: null, doi: "10.1000/seven" } },
	] }));
	const { named, rows } = await findPapers("the power of feedback", 50);
	expect(asked).toEqual([{ search: "the power of feedback" }]);
	expect(named).toBe(false);
	// The same key a pasted DOI or ID gives the work, so one picked from a title and pasted later is still one paper.
	expect(rows.map((row) => [row.key, row.state])).toEqual([["work:W1", "found"], ["doi:10.1000/seven", "waiting"]]);
});
