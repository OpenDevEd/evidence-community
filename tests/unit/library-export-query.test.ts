import { describe, expect, it, vi } from "vitest";

import { drizzle } from "drizzle-orm/node-postgres";

import { libraryConfigSchema } from "@/config/library-config/schema";
import { cloneLibraryConfig } from "../fixtures/library-config";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ getDatabaseForConfig: vi.fn() }));

import { schema } from "@/db/database-schema";
import {
	buildPublicLibraryKeysQuery,
	buildNewestRecordsQuery,
} from "@/lib/library-export-records";

// Drizzle only touches the client when a query runs, so an empty client is
// enough to compile a query to real SQL.
const database = drizzle({} as never, { schema }) as never;

/** The column names a compiled query asks the record table for. */
function selectedColumns(statement: string) {
	const selectList = statement.slice(
		"select ".length,
		statement.indexOf(' from "item"'),
	);

	return [...selectList.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
}

function configWithHiddenTags(hidden: string[]) {
	const draft = cloneLibraryConfig();
	(draft.content as any).tags.hidden = hidden;
	return libraryConfigSchema.parse(draft);
}

describe("whole-library citation query", () => {
	const compiled = buildPublicLibraryKeysQuery(
		database,
		configWithHiddenTags(["Hide-Me", "embargo"]),
		250,
	).toSQL();

	it("captures ordered keys in a single bounded query", () => {
		expect(compiled.sql).toMatch(/order by "item"\."key" asc/iu);
		expect(compiled.params).toContain(250);
		expect(compiled.sql).not.toMatch(/offset/iu);
	});

	it("leaves out deleted records, child records and notes", () => {
		expect(compiled.sql).toContain(`coalesce("item"."deleted", 0) <> 1`);
		expect(compiled.sql).toContain(`coalesce("item"."parentItem", '') = ''`);
		expect(compiled.sql).toContain(`"item"."itemType"::text not in`);
		for (const itemType of ["Note", "Attachment", "Annotation"]) {
			expect(compiled.params).toContain(itemType);
		}
	});

	// Hidden records must never reach a citation file or the feed. Tag
	// matching ignores letter case, as it does everywhere else in the runtime.
	it("leaves out records carrying a hidden tag, whatever the letter case", () => {
		expect(compiled.sql).toMatch(/not exists/iu);
		expect(compiled.sql).toContain(`lower("itemToTag"."tagName") in`);
		expect(compiled.sql).toContain(
			`"itemToTag"."itemKey" = "item"."key"`,
		);
		expect(compiled.params).toContain("hide-me");
		expect(compiled.params).toContain("embargo");
	});

	it("asks for no hidden-tag check when the library has no hidden tags", () => {
		const withoutHiddenTags = buildPublicLibraryKeysQuery(
			database,
			configWithHiddenTags([]),
			250,
		).toSQL();

		expect(withoutHiddenTags.sql).not.toMatch(/"itemToTag"/u);
	});

	it("holds only record keys until the bounded selection is known", () => {
		expect(selectedColumns(compiled.sql)).toEqual(["key"]);
	});
});

describe("Atom feed query", () => {
	const compiled = buildNewestRecordsQuery(
		database,
		configWithHiddenTags(["hide"]),
		50,
	).toSQL();

	it("takes the newest additions first", () => {
		expect(compiled.sql).toContain(`"item"."dateAdded" DESC NULLS LAST`);
		expect(compiled.params).toContain(50);
	});

	it("uses the same public-record rules as the citation files", () => {
		expect(compiled.sql).toContain(`coalesce("item"."deleted", 0) <> 1`);
		expect(compiled.sql).toMatch(/not exists/iu);
		expect(compiled.params).toContain("hide");
	});

	it("reads nothing heavier than the feed needs", () => {
		expect(selectedColumns(compiled.sql)).toEqual([
			"key",
			"title",
			"abstractNote",
			"creators",
			"date",
			"dateAdded",
			"dateModified",
			"updatedAt",
		]);
	});
});
