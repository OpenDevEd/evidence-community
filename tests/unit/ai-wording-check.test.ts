import { describe, expect, it } from "vitest";

import {
	aiWordingFiles,
	localeMessages,
	missingWording,
	scanWording,
	scanWordingInSource,
	wordingProblems,
	type Messages,
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
			import { useTranslations } from "next-intl";
			export function Screen() {
				const t = useTranslations("ai");
				return <p>{t("askAI")}</p>;
			}
		`);

		expect(names(uses)).toEqual(["ai.askAI"]);
	});

	it("finds wording asked for with rich text, markup and raw text", () => {
		const { uses } = scan(`
			import { useTranslations } from "next-intl";
			export function Screen() {
				const t = useTranslations("ai");
				return <p>{t.rich("poweredBy")}{t.markup("askAI")}{t.raw("reasoning")}</p>;
			}
		`);

		expect(names(uses)).toEqual([
			"ai.askAI",
			"ai.poweredBy",
			"ai.reasoning",
		]);
	});

	it("remembers which way each piece of wording is read", () => {
		const { uses } = scan(`
			import { useTranslations } from "next-intl";
			export function Screen() {
				const t = useTranslations("ai");
				return <p>{t("askAI")}{t.raw("models")}</p>;
			}
		`);

		expect(
			uses.map(({ key, method }) => `${key}:${method}`).sort(),
		).toEqual(["askAI:call", "models:raw"]);
	});

	it("keeps two readers in the same file apart", () => {
		const { uses } = scan(`
			import { useTranslations } from "next-intl";
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
			import { useTranslations } from "next-intl";
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
			import { useTranslations } from "next-intl";
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
			import { useTranslations } from "next-intl";
			export function Screen({ suffix }) {
				const t = useTranslations("ai");
				return <p>{t(\`ask\${suffix}\`)}</p>;
			}
		`);

		expect(uses).toEqual([]);
		expect(dynamic).toEqual([
			{ file: "Screen.tsx", group: "ai", line: 5 },
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

	// A name given to something else hides the translator of the same name,
	// so its calls are not wording at all.
	it("lets a plain local of the same name hide the translator", () => {
		const { uses, dynamic } = scan(`
			import { useTranslations } from "next-intl";
			export function Screen() {
				const t = useTranslations("ai");
				function label() {
					const t = (value: string) => value;
					return t("not-wording");
				}
				return <p>{t("askAI")}{label()}</p>;
			}
		`);

		expect(names(uses)).toEqual(["ai.askAI"]);
		expect(dynamic).toEqual([]);
	});

	it("lets a callback argument of the same name hide the translator", () => {
		const { uses } = scan(`
			import { useTranslations } from "next-intl";
			export function Screen({ items }) {
				const t = useTranslations("ai");
				return <p>{t("askAI")}{items.map((t) => t("not-wording"))}</p>;
			}
		`);

		expect(names(uses)).toEqual(["ai.askAI"]);
	});

	// Only next-intl provides wording. A helper of the same name does not.
	it("ignores a useTranslations of its own that is not next-intl", () => {
		const { uses } = scan(`
			function useTranslations(group: string) {
				return (key: string) => key;
			}
			export function Screen() {
				const t = useTranslations("ai");
				return <p>{t("askAI")}</p>;
			}
		`);

		expect(uses).toEqual([]);
	});

	it("follows the name next-intl was imported under", () => {
		const { uses } = scan(`
			import { useTranslations as useWording } from "next-intl";
			export function Screen() {
				const t = useWording("ui");
				return <p>{t("cancel")}</p>;
			}
		`);

		expect(names(uses)).toEqual(["ui.cancel"]);
	});
});

describe("comparing that wording with a language", () => {
	const uses: WordingUse[] = [
		{ file: "Screen.tsx", group: "ai", key: "askAI", method: "call" },
		{ file: "Screen.tsx", group: "ui", key: "cancel", method: "call" },
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

	// `raw` hands back whatever the language file holds, which is often a
	// list or a record rather than a sentence.
	it("accepts a list or a record when the screen reads it raw", () => {
		expect(
			missingWording(
				[
					{
						file: "Screen.tsx",
						group: "ai",
						key: "models",
						method: "raw",
					},
					{
						file: "Screen.tsx",
						group: "ai",
						key: "limits",
						method: "raw",
					},
				],
				{ ai: { models: ["one", "two"], limits: { max: 5 } } },
			),
		).toEqual([]);
	});

	it("still reports wording read raw that the language does not have", () => {
		expect(
			missingWording(
				[
					{
						file: "Screen.tsx",
						group: "ai",
						key: "models",
						method: "raw",
					},
				],
				{ ai: {} },
			),
		).toEqual(["ai.models"]);
	});

	it("needs a sentence for wording that is read as text", () => {
		expect(
			missingWording(
				[
					{
						file: "Screen.tsx",
						group: "ai",
						key: "models",
						method: "markup",
					},
				],
				{ ai: { models: ["one", "two"] } },
			),
		).toEqual(["ai.models"]);
	});
});

describe("the screens the check reads", () => {
	const files = aiWordingFiles();
	const reference = localeMessages()[0];

	/** One language loses something; the others still have it. */
	function damaged(change: (messages: Messages) => void) {
		return wordingProblems(
			files,
			localeMessages().map((entry) => {
				if (entry.locale !== reference.locale) return entry;
				const copy = structuredClone(entry.messages);
				change(copy);

				return { ...entry, messages: copy };
			}),
		);
	}

	// The old check read a hand-picked list and never saw these screens.
	it("reads every screen that owns AI wording", () => {
		expect(files.map(({ file }) => file)).toEqual(
			expect.arrayContaining([
				"src/components/features/ai/ModelSelector.tsx",
				"src/components/features/ai/ScreeningLimitConfirmation.tsx",
				"src/components/features/modals/AIControls.tsx",
				"src/components/features/modals/ChatModal.tsx",
				"src/components/features/modals/GenerativeModal.tsx",
				"src/components/features/newlib/AiWrapper.tsx",
				"src/components/pages/EvidenceLibrary.tsx",
				"src/hooks/useAIStream.ts",
			]),
		);
	});

	it("is happy with the wording the library ships", () => {
		expect(wordingProblems(files, localeMessages())).toEqual([]);
	});

	it("reports wording an export control needs but a language lost", () => {
		const problems = damaged((messages) => {
			delete messages.ai.copyAsCSV;
		});

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('"ai.copyAsCSV"');
		expect(problems[0]).toContain("AIControls.tsx");
	});

	// The dropdown is handed its translator by the screen that draws it, so
	// the check has to follow it there.
	it("reports wording a handed-over translator needs but a language lost", () => {
		const problems = damaged((messages) => {
			delete messages.ai.summarizeDescription;
		});

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('"ai.summarizeDescription"');
		expect(problems[0]).toContain("AIDropdownItems.tsx");
	});

	it("reports wording the streaming helper needs but a language lost", () => {
		const problems = damaged((messages) => {
			delete messages.ai.rateLimitedMessage;
		});

		expect(problems[0]).toContain('"ai.rateLimitedMessage"');
		expect(problems[0]).toContain("useAIStream.ts");
	});

	it("reports wording the library page needs but a language lost", () => {
		const problems = damaged((messages) => {
			delete messages.ai.askMeAnythingPublications;
		});

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain('"ai.askMeAnythingPublications"');
	});

	// Sort and scope labels are chosen from a catalog while the page runs, so
	// the whole group has to be there rather than one name.
	it("reports a group a language lost when the name is chosen while running", () => {
		const problems = damaged((messages) => {
			delete messages.sorts.relevance;
		});

		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("sorts");
		expect(problems[0]).toContain("relevance");
	});
});

describe("names that only look like the translator", () => {
	it("lets a local of the same name hide the imported hook", () => {
		const { uses } = scan(`
			import { useTranslations } from "next-intl";
			export function Screen() {
				function useTranslations() {
					return (key: string) => key;
				}
				const t = useTranslations("ai");
				return <p>{t("not-wording")}</p>;
			}
		`);

		expect(uses).toEqual([]);
	});

	it("lets an argument hide the name next-intl came in under", () => {
		const { uses } = scan(`
			import { useTranslations as useWording } from "next-intl";
			export function Screen({ useWording }) {
				const t = useWording("ai");
				return <p>{t("not-wording")}</p>;
			}
		`);

		expect(uses).toEqual([]);
	});

	it("lets a local hide a whole next-intl namespace", () => {
		const { uses } = scan(`
			import * as intl from "next-intl";
			export function Screen() {
				const intl = { useTranslations: (g: string) => (k: string) => k };
				const t = intl.useTranslations("ai");
				return <p>{t("not-wording")}</p>;
			}
		`);

		expect(uses).toEqual([]);
	});

	it("still reads wording through a next-intl namespace", () => {
		const { uses } = scan(`
			import * as intl from "next-intl";
			export function Screen() {
				const t = intl.useTranslations("ai");
				return <p>{t("askAI")}</p>;
			}
		`);

		expect(names(uses)).toEqual(["ai.askAI"]);
	});
});

describe("a translator handed to another function", () => {
	it("follows the group from the place that hands it over", () => {
		const { uses } = scanWording([
			{
				file: "menu.tsx",
				source: `
					export const MENU_ITEMS = (t: any, count: number) => [
						{ label: t("change") },
					];
				`,
			},
			{
				file: "Screen.tsx",
				source: `
					import { useTranslations } from "next-intl";
					import { MENU_ITEMS } from "./menu";
					export function Screen() {
						const t = useTranslations("ai");
						return <ul>{MENU_ITEMS(t, 2)}</ul>;
					}
				`,
			},
		]);

		expect(names(uses)).toEqual(["ai.change"]);
	});

	it("leaves a plain argument alone", () => {
		const { uses } = scanWording([
			{
				file: "menu.tsx",
				source: `
					export const MENU_ITEMS = (label: any) => [
						{ label: label("change") },
					];
				`,
			},
			{
				file: "Screen.tsx",
				source: `
					import { MENU_ITEMS } from "./menu";
					export function Screen({ label }) {
						return <ul>{MENU_ITEMS(label)}</ul>;
					}
				`,
			},
		]);

		expect(uses).toEqual([]);
	});
});

describe("names resolved to what they actually are", () => {
	it("does not trust a local declared after it is used", () => {
		const { uses } = scan(`
			import { useTranslations } from "next-intl";
			export function Screen() {
				const t = useTranslations("ai");
				return <p>{t("not-wording")}</p>;
			}
			function useTranslations(group: string) {
				return (key: string) => key;
			}
		`);

		expect(uses).toEqual([]);
	});

	it("follows the hook through a helper of another name", () => {
		const { uses } = scanWording([
			{
				file: "wording.ts",
				source: `
					import { useTranslations } from "next-intl";
					export const useAiWording = () => useTranslations("ai");
				`,
			},
			{
				file: "Screen.tsx",
				source: `
					import { useAiWording } from "./wording";
					export function Screen() {
						const t = useAiWording();
						return <p>{t("askAI")}</p>;
					}
				`,
			},
		]);

		expect(names(uses)).toEqual(["ai.askAI"]);
	});

	it("keeps two helpers of the same name in different files apart", () => {
		const { uses } = scanWording([
			{
				file: "menu.tsx",
				source: `
					export const ITEMS = (t: any) => [{ label: t("change") }];
				`,
			},
			{
				file: "other.tsx",
				source: `
					export const ITEMS = (label: any) => [
						{ label: label("not-wording") },
					];
				`,
			},
			{
				file: "Screen.tsx",
				source: `
					import { useTranslations } from "next-intl";
					import { ITEMS } from "./menu";
					export function Screen() {
						const t = useTranslations("ai");
						return <ul>{ITEMS(t)}</ul>;
					}
				`,
			},
		]);

		expect(names(uses)).toEqual(["ai.change"]);
	});
});

describe("a translator given a second name", () => {
	it("follows a plain copy of the translator", () => {
		const { uses } = scan(`
			import { useTranslations } from "next-intl";
			export function Screen() {
				const t = useTranslations("ai");
				const translate = t;
				return <p>{translate("askAI")}</p>;
			}
		`);

		expect(names(uses)).toEqual(["ai.askAI"]);
	});

	it("follows a copy of a copy", () => {
		const { uses } = scan(`
			import { useTranslations } from "next-intl";
			export function Screen() {
				const t = useTranslations("ai");
				const translate = t;
				const say = translate;
				return <p>{say("askAI")}</p>;
			}
		`);

		expect(names(uses)).toEqual(["ai.askAI"]);
	});

	it("does not copy a name that is not a translator", () => {
		const { uses } = scan(`
			import { useTranslations } from "next-intl";
			export function Screen(label: (key: string) => string) {
				const t = useTranslations("ai");
				const translate = label;
				return <p>{t("askAI")}{translate("not-wording")}</p>;
			}
		`);

		expect(names(uses)).toEqual(["ai.askAI"]);
	});
});
