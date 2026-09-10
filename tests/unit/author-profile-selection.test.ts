import {expect, it} from "vitest";
import {creatorFromProfile, parseAuthorCatalog} from "@/lib/authors/profiles";

it("uses the selected profile's full name without guessing a split or changing the creator role", () => {
  const creator = {creatorType: "editor", firstName: "Old", lastName: "Name", authorProfileId: "previous"};
  expect(creatorFromProfile(creator, {id: "selected", name: "Nguyễn Thị Minh Khai"})).toEqual({creatorType: "editor", firstName: "", lastName: "Nguyễn Thị Minh Khai", authorProfileId: "selected"});
  expect(creator).toEqual({creatorType: "editor", firstName: "Old", lastName: "Name", authorProfileId: "previous"});
  expect(creatorFromProfile({creatorType: "author", name: "Old institution"}, {id: "selected", name: "Research Collective"})).toEqual({creatorType: "author", name: "Research Collective", authorProfileId: "selected"});
});

it("resolves the configuration link against the OpenScholar origin", () => {
  const result = parseAuthorCatalog({profileBaseUrl: "https://openscholar.example", profiles: [{id: "profile1", name: "Caitlin Mills", revision: 4, headline: "Professor", affiliation: "University of Minnesota", bio: "", website: "", linkedin: "", orcid: "", openalex: "", photo: "https://example.org/photo.png", canEdit: false}]});
  expect(result.profiles[0]).toMatchObject({url: "https://openscholar.example/authors/profile1", photo: "https://example.org/photo.png", canEdit: false});
});
