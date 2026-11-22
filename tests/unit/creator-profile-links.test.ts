import { expect, it } from "vitest";
import { preserveCreatorProfileLinks, sameBibliographicCreators } from "@/lib/admin/creator-profile-links";

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

it("carries an author's affiliations across a source update, like the profile link", () => {
	const institutions = [{display_name: "University of Nairobi"}];
	const caitlin = {creatorType: "author", firstName: "Caitlin", lastName: "Mills"};
	const alex = {creatorType: "author", name: "Alex Rivera"};
	expect(preserveCreatorProfileLinks([alex, caitlin], [{...caitlin, institutions}, alex])).toEqual([alex, {...caitlin, institutions}]);
	expect(preserveCreatorProfileLinks([{...caitlin, lastName: "Miller"}], [{...caitlin, institutions}])).toEqual([{...caitlin, lastName: "Miller"}]);
});

// Zotero has no field for it, so an update from Zotero would turn an organisation an editor picked back into a person.
it("carries an organisation's mark across a source update", () => {
	const unesco = {creatorType: "author", name: "UNESCO"};
	expect(preserveCreatorProfileLinks([unesco], [{...unesco, organization: true as const}])).toEqual([{...unesco, organization: true}]);
	expect(preserveCreatorProfileLinks([{...unesco, name: "UNICEF"}], [{...unesco, organization: true as const}])).toEqual([{...unesco, name: "UNICEF"}]);
});

it("sees no source change when only a profile link or an affiliation changes", () => {
	const caitlin = {creatorType: "author", firstName: "Caitlin", lastName: "Mills"};
	expect(sameBibliographicCreators([caitlin], [{...caitlin, authorProfileId: "p1", institutions: [{display_name: "University of Nairobi"}]}])).toBe(true);
	expect(sameBibliographicCreators([caitlin], [{...caitlin, lastName: "Miller"}])).toBe(false);
	expect(sameBibliographicCreators([caitlin], [caitlin, caitlin])).toBe(false);
	expect(sameBibliographicCreators(undefined, [caitlin])).toBe(false);
});
