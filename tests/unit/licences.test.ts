import { describe, expect, it } from "vitest";

import { licenceFromRights } from "@/lib/licences";

describe("the licence a rights statement names", () => {
	it.each([
		["© 2023 The Authors. This is an open access article under the CC BY 4.0 license.", "cc-by-4.0"],
		["Licensed under CC BY-NC-SA 4.0", "cc-by-nc-sa-4.0"],
		["https://creativecommons.org/licenses/by-nc-nd/4.0/", "cc-by-nc-nd-4.0"],
		["CC0", "cc0-1.0"],
		["Creative Commons Attribution 4.0 International", "cc-by-4.0"],
	])("reads %s as %s", (rights, id) => {
		expect(licenceFromRights(rights)).toBe(id);
	});

	// A licence without its version, or a statement that names none, is left for a person to pick, never guessed.
	it.each(["CC BY", "© World Bank. All rights reserved.", ""])("finds none in %j", (rights) => {
		expect(licenceFromRights(rights)).toBeNull();
	});
});
