import { describe, expect, it } from "vitest";

import {
	missingWording,
	scanWordingInSource,
	type WordingUse,
} from "../../tools/aiWording";

function scan(source: string) {
	return scanWordingInSource("Screen.tsx", source);
}

function names(uses: WordingUse[]) {
	return uses.map(({ group, key }) => `${group}.${key}`).sort();
}

describe("reading the wording an AI screen asks for", () => {
	it("finds wording asked for through a named reader", () => {
		const { uses } = scan(`
			export function Screen() {
				const t = useTranslations("ai");
				return <p>{t("askAI")}</p>;
			}
		`);

		expect(names(uses)).toEqual(["ai.askAI"]);
	});

	it("finds wording asked for with rich text and raw text", () => {
		const { uses } = scan(`
			export function Screen() {
				const t = useTranslations("ai");
				return <p>{t.rich("poweredBy")}{t.raw("reasoning")}</p>;
			}
		`);

		expect(names(uses)).toEqual(["ai.poweredBy", "ai.reasoning"]);
	});

	it("keeps two readers in the same file apart", () => {
		const { uses } = scan(`
			export function Screen() {
				const t = useTranslations("ai");
				const tUI = useTranslations("ui");
				return <p>{t("askAI")}{tUI("cancel")}</p>;
			}
		`);

		expect(names(uses)).toEqual(["ai.askAI", "ui.cancel"]);
	});

	// The old check matched text, so the first `const t = ...` in a file won
	// and everything after it was filed under the wrong group.
	it("gives each function its own meaning of the same reader name", () => {
		const { uses } = scan(`
			function Header() {
				const t = useTranslations("ai");
				return <h1>{t("askAI")}</h1>;
			}
			function Footer() {
				const t = useTranslations("ui");
				return <p>{t("cancel")}</p>;
			}
		`);

		expect(names(uses)).toEqual(["ai.askAI", "ui.cancel"]);
	});

	it("reads both names when a screen chooses between two", () => {
		const { uses, dynamic } = scan(`
			export function Screen({ open }) {
				const t = useTranslations("ai");
				return <p>{t(open ? "askMeAnything" : "askAI")}</p>;
			}
		`);

		expect(names(uses)).toEqual(["ai.askAI", "ai.askMeAnything"]);
		expect(dynamic).toEqual([]);
	});

	it("reports a name that is only worked out while the app runs", () => {
		const { uses, dynamic } = scan(`
			export function Screen({ suffix }) {
				const t = useTranslations("ai");
				return <p>{t(\`ask\${suffix}\`)}</p>;
			}
		`);

		expect(uses).toEqual([]);
		expect(dynamic).toEqual([
			{ file: "Screen.tsx", group: "ai", line: 4 },
		]);
	});

	it("ignores a plain function that happens to be called t", () => {
		const { uses, dynamic } = scan(`
			export function Screen() {
				const t = (value: string) => value;
				return <p>{t("askAI")}</p>;
			}
		`);

		expect(uses).toEqual([]);
		expect(dynamic).toEqual([]);
	});
});

describe("comparing that wording with a language", () => {
	const uses: WordingUse[] = [
		{ file: "Screen.tsx", group: "ai", key: "askAI" },
		{ file: "Screen.tsx", group: "ui", key: "cancel" },
	];

	it("says nothing is missing when the language has it all", () => {
		expect(
			missingWording(uses, {
				ai: { askAI: "Ask AI" },
				ui: { cancel: "Cancel" },
			}),
		).toEqual([]);
	});

	it("names the wording the language does not have", () => {
		expect(
			missingWording(uses, { ai: { askAI: "Ask AI" }, ui: {} }),
		).toEqual(["ui.cancel"]);
	});

	it("treats a whole missing group as missing wording", () => {
		expect(missingWording(uses, { ai: { askAI: "Ask AI" } })).toEqual([
			"ui.cancel",
		]);
	});
});
