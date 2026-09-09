import { expect, it } from "vitest";
import { preserveCreatorProfileLinks } from "@/lib/admin/creator-profile-links";

it("keeps local links when source authors reorder but never trusts source profile IDs", () => {
	const caitlin = {creatorType: "author", firstName: "Caitlin", lastName: "Mills"};
	const alex = {creatorType: "author", name: "Alex Rivera"};
	expect(preserveCreatorProfileLinks([alex, {...caitlin, authorProfileId: "forged"}], [{...caitlin, authorProfileId: "local-profile"}, alex])).toEqual([alex, {...caitlin, authorProfileId: "local-profile"}]);
	expect(preserveCreatorProfileLinks([{...alex, authorProfileId: "forged"}], [])).toEqual([alex]);
});

it("does not guess a profile when names change or duplicate authors are ambiguous", () => {
	const author = {creatorType: "author", name: "M. Chen"};
	const previous = [{...author, authorProfileId: "first"}, {...author, authorProfileId: "second"}];
	expect(preserveCreatorProfileLinks([author, author], previous)).toEqual(previous);
	expect(preserveCreatorProfileLinks([author], previous)).toEqual([author]);
	expect(preserveCreatorProfileLinks([{...author, name: "Different person"}], previous)).toEqual([{...author, name: "Different person"}]);
});
