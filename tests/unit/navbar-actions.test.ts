import { describe, expect, it } from "vitest";

import { navbarActionSteps } from "@/lib/navbar-actions";

const theme = { kind: "theme" } as const;
const settingsMenu = { kind: "settingsMenu" } as const;
const signIn = { kind: "signIn" } as const;
const menu = { kind: "menu" } as const;

describe("header action steps", () => {
	it("shows the light or dark switch as its own button when it is the only setting", () => {
		expect(navbarActionSteps(["theme"], false)).toEqual([[theme]]);
	});

	it("always opens the languages from the settings menu, even when they are the only setting", () => {
		expect(navbarActionSteps(["language"], false)).toEqual([[settingsMenu]]);
		expect(navbarActionSteps(["theme", "language"], false)).toEqual([[settingsMenu]]);
	});

	it("keeps Sign in beside the settings until there is no room, then folds both into one menu", () => {
		expect(navbarActionSteps(["theme"], true)).toEqual([[theme, signIn], [menu]]);
		expect(navbarActionSteps(["theme", "language"], true)).toEqual([[settingsMenu, signIn], [menu]]);
	});

	it("leaves Sign in as a button when there are no settings to fold it into", () => {
		expect(navbarActionSteps([], true)).toEqual([[signIn]]);
		expect(navbarActionSteps([], false)).toEqual([[]]);
	});
});
