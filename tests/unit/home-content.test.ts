import { describe, expect, it } from "vitest";

import { contentFrom, defaultContent } from "@/components/pages/home-content";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";

const stepTitles = { arrival: "Submitted", check: "Checked by an editor", publication: "Published", search: "Found by search", sync: "Kept up to date", duplicates: "Duplicates merged", fulltext: "Full text added" };

function parseHome(home: unknown) {
	return libraryConfigSchema.safeParse({ ...maximalLibraryConfig, home });
}

describe("home page content", () => {
	it("accepts the Home card's answers", () => {
		const parsed = parseHome(maximalLibraryConfig.home);
		expect(parsed.success).toBe(true);
	});

	it("keeps a blank question slot for the question the page makes", () => {
		const home = libraryConfigSchema.parse({ ...maximalLibraryConfig, home: { questions: ["", "Mine?"] } }).home!;
		expect(contentFrom(home, stepTitles).questions).toEqual(["", "Mine?"]);
	});

	it("needs a title on a text-only step, but not on a typed one", () => {
		expect(parseHome({ curation: { steps: [{ type: "arrival" }] } }).success).toBe(true);
		const untitled = parseHome({ curation: { steps: [{ type: "text", text: "Words" }] } });
		expect(untitled.success).toBe(false);
		expect(untitled.error?.issues[0]?.path).toEqual(["home", "curation", "steps", 0, "title"]);
	});

	it("names typed steps after their type and shows a chosen editor from the people OpenScholar filled in", () => {
		const home = libraryConfigSchema.parse(maximalLibraryConfig).home!;
		const content = contentFrom(home, stepTitles);
		expect(content.curation?.steps?.map((step) => step.title)).toEqual(["Submitted", "Read by an editor", "Summarised", "Published"]);
		expect(content.curation?.steps?.[1]?.editor).toEqual({ name: "Amina Yusuf", photo: "https://img.example.org/amina.png" });
		expect(content.curation?.steps?.[0]?.editor).toBeUndefined();
		expect(content.editors).toEqual([{ name: "Amina Yusuf", title: "Editor in chief", location: "Nairobi, Kenya", photo: "https://img.example.org/amina.png" }]);
	});

	it("puts a typed step's own icon on its node unless the owner chose one, and none on a text step by default", () => {
		const home = libraryConfigSchema.parse(maximalLibraryConfig).home!;
		expect(contentFrom(home, stepTitles).curation?.steps?.map((step) => step.icon)).toEqual(["InboxDownloadIcon", "UserCheck01Icon", undefined, "BookOpen01Icon"]);
		const chosen = libraryConfigSchema.parse({ ...maximalLibraryConfig, home: { curation: { steps: [{ type: "search", icon: "AiSearchIcon" }, { type: "text", title: "Screened", icon: "AiBrain01Icon" }] } } }).home!;
		expect(contentFrom(chosen, stepTitles).curation?.steps?.map((step) => step.icon)).toEqual(["AiSearchIcon", "AiBrain01Icon"]);
	});

	it("never passes the editor directory to the page", () => {
		const home = libraryConfigSchema.parse(maximalLibraryConfig).home!;
		expect(JSON.stringify(contentFrom(home, stepTitles))).not.toContain("user_editor_two");
		expect(JSON.stringify(contentFrom(home, stepTitles))).not.toContain("Omar Haddad");
	});

	it("gives a library without answers a generated introduction and the suggestion button", () => {
		expect(defaultContent("Test Library")).toEqual({
			intro: expect.stringContaining("**Test Library**"),
			involvement: { suggestions: true, editors: false },
		});
	});
});
