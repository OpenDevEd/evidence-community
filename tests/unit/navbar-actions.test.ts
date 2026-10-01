import { describe, expect, it } from "vitest";

import { navbarActionSteps } from "@/lib/navbar-actions";

const theme = { kind: "setting", setting: "theme" } as const;
const language = { kind: "setting", setting: "language" } as const;
const signIn = { kind: "signIn" } as const;

describe("header action steps", () => {
	it("shows a single setting as its own control, never behind a menu of one", () => {
		expect(navbarActionSteps(["theme"], false)).toEqual([[theme]]);
	});

	it("keeps Sign in beside a single setting until there is no room, then folds both into one menu", () => {
		expect(navbarActionSteps(["theme"], true)).toEqual([[theme, signIn], [{ kind: "menu" }]]);
	});

	it("groups two settings behind one button before Sign in folds away", () => {
		expect(navbarActionSteps(["theme", "language"], true)).toEqual([
			[theme, language, signIn],
			[{ kind: "settingsMenu" }, signIn],
			[{ kind: "menu" }],
		]);
		expect(navbarActionSteps(["theme", "language"], false)).toEqual([[theme, language], [{ kind: "settingsMenu" }]]);
	});

	it("leaves Sign in as a button when there are no settings to fold it into", () => {
		expect(navbarActionSteps([], true)).toEqual([[signIn]]);
		expect(navbarActionSteps([], false)).toEqual([[]]);
	});
});
