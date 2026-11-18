import { describe, expect, it } from "vitest";

import {
	computeAdminDraftDiff,
	EMPTY_ADMIN_DRAFT_DIFF,
} from "@/components/admin/admin-diff";
import {
	editablePayloadFromDetail,
	type AdminSchemaDefinition,
} from "@/components/admin/admin-schema";
import type { AdminItemDetail } from "@/lib/admin/types";

const definition: AdminSchemaDefinition = {
	creatorTypes: [{ creatorType: "author", primary: true }],
	fields: [
		{ field: "title" },
		{ field: "language" },
		{ field: "abstractNote" },
	],
	itemType: "book",
};

function detail(overrides: Partial<AdminItemDetail> = {}): AdminItemDetail {
	return {
		sourceFields: [], importedTopics: [], importChecks: null, withdrawn: false,
		openalexId: null,
		addedPaper: false,
		kind: "created",
		importMethod: null,
		attachments: [],
		collectionKeys: ["CURRENT"],
		creators: [],
		date: null,
		draft: {
			baseRevision: 1,
			createdAt: "2026-01-01T00:00:00.000Z",
			draftRevision: 1,
			generation: "c8df1386-3420-4f12-8c20-7fb1c31ae0ad",
			itemKey: "BOOK0001",
			patch: {},
			payload: {},
			sourceConnectionKey: "native",
			updatedAt: "2026-01-01T00:00:00.000Z",
		},
		editable: true,
		fileDraft: null,
		filePublication: null,
		fileRemovalPending: false,
		openAccessFromSources: null,
		readingStudyType: null,
		links: {
			fromSources: [],
			citedBy: [],
			keys: { cites: [], related: [] },
			publishedKeys: { cites: [], related: [] },
			targets: [],
		},
		fileState: "none",
		itemType: "book",
		key: "BOOK0001",
		parentItem: null,
		parentState: null,
		published: {
			abstractNote: null,
			creators: [],
			itemType: "book",
			language: "English",
			title: "Published title",
		},
		publishedCollectionKeys: ["PUBLISHED"],
		publishedTags: ["evidence"],
		revision: 1,
		sourceConnectionKey: "native",
		sourceFileUrl: null,
		sourcePdf: null,
		sourcePdfChangePending: false,
		state: "edited",
		tags: ["draft"],
		title: "Draft title",
		updatedAt: "2026-01-01T00:00:00.000Z",
		writeback: {
			available: [],
			originSourceKey: null,
			selected: [],
		},
		...overrides,
	};
}

describe("computeAdminDraftDiff", () => {
	it.each([["KE", "UG"], []])(
		"preserves published manual countries in the editor and duplicate payload: %j",
		(...countries) => {
			const payload = editablePayloadFromDetail(
				detail({
					draft: null,
					published: { itemType: "book", countryFocus: countries },
				}),
				[definition],
			);
			expect(payload.countryFocus).toEqual(countries);
		},
	);
	it("shows a published record's topics in the editor and duplicate payload", () => {
		const payload = editablePayloadFromDetail(
			detail({
				draft: null,
				published: { itemType: "book", topics: ["T14414"] },
			}),
			[definition],
		);
		expect(payload.topics).toEqual(["T14414"]);
	});
	it("compares the item-specific language field and treats empty values equally", () => {
		const result = computeAdminDraftDiff(
			detail(),
			{
				abstractNote: "",
				collections: ["CURRENT"],
				creators: [],
				itemType: "Book",
				language: "French",
				tags: ["draft"],
				title: "Published title",
			},
			definition,
		);

		expect(result.itemType).toBeNull();
		expect(result.fields).toEqual({ language: "English" });
		expect(result.tags).toEqual(["evidence"]);
		expect(result.collections).toEqual(["PUBLISHED"]);
	});

	it("normalizes creator whitespace and unordered tag and collection sets", () => {
		const originalCreators = [
			{
				creatorType: "author",
				firstName: "Ada",
				lastName: "Lovelace",
			},
		];
		const result = computeAdminDraftDiff(
			detail({
				published: {
					creators: originalCreators,
					itemType: "book",
					title: "Published title",
				},
				publishedCollectionKeys: ["B", "A"],
				publishedTags: ["two", "one"],
			}),
			{
				collections: ["A", "B"],
				creators: [
					{
						creatorType: "author",
						firstName: " Ada ",
						lastName: "Lovelace",
					},
				],
				itemType: "book",
				tags: ["one", "two"],
				title: "Published title",
			},
			definition,
		);

		expect(result.creators).toBeNull();
		expect(result.tags).toBeNull();
		expect(result.collections).toBeNull();
	});

	it("returns the published collection, creator, and tag values for reverting", () => {
		const originalCreators = [{ creatorType: "author", name: "OpenDevEd" }];
		const result = computeAdminDraftDiff(
			detail({
				published: {
					creators: originalCreators,
					itemType: "book",
					title: "Published title",
				},
			}),
			{
				collections: [],
				creators: [],
				itemType: "report",
				tags: [],
				title: "Draft title",
			},
			definition,
		);

		expect(result.itemType).toBe("book");
		expect(result.fields.title).toBe("Published title");
		expect(result.creators).toEqual(originalCreators);
		expect(result.tags).toEqual(["evidence"]);
		expect(result.collections).toEqual(["PUBLISHED"]);
	});

	it("does not mark an unpublished draft because every value is new", () => {
		expect(
			computeAdminDraftDiff(
				detail({
					published: null,
					publishedCollectionKeys: [],
					publishedTags: [],
				}),
				{ itemType: "book", title: "New book" },
				definition,
			),
		).toEqual(EMPTY_ADMIN_DRAFT_DIFF);
	});

	it("reports link changes against the published link keys and ignores order", () => {
		const base = detail({
			links: {
				fromSources: [],
				citedBy: [],
				keys: { cites: ["AAAA2345"], related: [] },
				publishedKeys: { cites: ["AAAA2345"], related: ["BBBB2345"] },
				targets: [],
			},
		});
		const payload = {
			collections: ["CURRENT"],
			creators: [],
			itemType: "book",
			language: "English",
			tags: ["evidence"],
			title: "Published title",
		};
		expect(
			computeAdminDraftDiff(
				base,
				{ ...payload, links: { cites: ["AAAA2345"], related: ["BBBB2345"] } },
				definition,
			).links,
		).toBeNull();
		expect(
			computeAdminDraftDiff(
				base,
				{ ...payload, links: { related: ["BBBB2345"], cites: ["AAAA2345"] } },
				definition,
			).links,
		).toBeNull();
		expect(
			computeAdminDraftDiff(
				base,
				{ ...payload, links: { cites: [], related: ["BBBB2345", "CCCC2345"] } },
				definition,
			).links,
		).toEqual({ cites: ["AAAA2345"], related: ["BBBB2345"] });
		expect(computeAdminDraftDiff(base, payload, definition).links).toBeNull();
	});
});

it("recognizes a profile association change even when the bibliographic author is unchanged", () => {
	const creators = [{creatorType: "author", firstName: "Caitlin", lastName: "Mills"}];
	const record = detail({published: {creators}});
	expect(computeAdminDraftDiff(record, {creators: [{...creators[0], authorProfileId: "profile-id"}]}, definition).creators).toEqual(creators);
});
