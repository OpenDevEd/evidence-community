import { describe, expect, it } from "vitest";
import { homeSearchTitle } from "@/config/library-config/identity";
import type { LibraryServerConfig } from "@/config/library-config/schema";

const identity = (fields: Partial<LibraryServerConfig["identity"]>) => ({ name: "Artificial Intelligence in Education", ...fields }) as LibraryServerConfig["identity"];

describe("home page title in search results", () => {
	it("uses the owner's own title when they set one", () => {
		expect(homeSearchTitle(identity({ tagline: "Research, gathered nightly", searchTitle: " AI in Education Research and Evidence " }))).toBe("AI in Education Research and Evidence");
	});

	it("falls back to the name and the tagline, then the name alone", () => {
		expect(homeSearchTitle(identity({ tagline: "Research, gathered nightly", searchTitle: "  " }))).toBe("Artificial Intelligence in Education: Research, gathered nightly");
		expect(homeSearchTitle(identity({}))).toBe("Artificial Intelligence in Education");
	});
});
