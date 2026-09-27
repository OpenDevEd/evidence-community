import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/config/library-config/server", async () => {
	const { libraryConfigSchema } = await import("@/config/library-config/schema");
	const { minimalLibraryConfig } = await import("../fixtures/library-config");
	const config = libraryConfigSchema.parse(minimalLibraryConfig);
	return { getLibraryConfig: async () => ({ ...config, content: { ...config.content, tags: { ...config.content.tags, hidden: ["hide"] } } }) };
});
import { sourceConnection, sourceRecordIssue } from "@opendeved/evidence-library-core";

import {
	dismissAdminSourceIssues,
	getAdminSourceIssuePage,
	getAdminSourceIssueTypes,
	restoreAdminSourceIssues,
} from "../../src/lib/admin/source-issues";
import { writeSourceIngestionBatch } from "../../src/lib/source-ingestion/transactional-writer";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const SOURCE = "zotero-issues";

const report = (key: string, title: string, issue: { code: string; message: string }, extra: Record<string, unknown> = {}) => ({
	operation: "upsert" as const,
	sourceRecordKey: key,
	remoteVersion: "1",
	raw: { key, version: 1 },
	metadata: {
		itemType: "Report",
		title,
		date: "2018",
		creators: [
			{ creatorType: "author", firstName: "Benjamin", lastName: "Piper" },
			{ creatorType: "author", firstName: "Jessica", lastName: "Oyanga" },
			{ creatorType: "author", firstName: "Evelyn", lastName: "Mejia" },
		],
		...extra,
	},
	processingIssue: issue,
});

const pages = { offset: 0, limit: 10 };

it("groups a source's issues by what to do about them, pages each type, and undoes a dismissal", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values({ key: SOURCE, provider: "zotero", scopeKind: "group", externalScopeKey: "2129771" });
		await writeSourceIngestionBatch(db, {
			sourceConnectionKey: SOURCE,
			expectedCursor: {},
			nextCursor: { libraryVersion: 1 },
			mappingProfileVersion: "test",
			fetchedAt: new Date(),
			collections: [],
			items: [
				report("FIELDS11", "Scaling up successfully", {
					code: "zotero_fields_dropped",
					message: "Some fields could not be stored and were left out: abstractNote (Too long); extra (Too long).",
				}),
				report("NOMD5222", "Teacher factors", {
					code: "zotero_file_metadata_invalid",
					message: "Zotero attachment NOMD5222: a published PDF must have a valid filename and MD5",
				}),
				report("NOURL333", "Instructional technology", {
					code: "zotero_file_metadata_invalid",
					message: "Zotero attachment NOURL333: a published linked URL must have a valid URL",
				}),
				report(
					"HIDDEN44",
					"Hidden report",
					{ code: "zotero_file_unavailable", message: "Zotero attachment HIDDEN44: 404 Not Found" },
					{ tags: ["hide"] },
				),
			],
		});
		// Records the library does not hold, newest last.
		await db.insert(sourceRecordIssue).values(
			[1, 2, 3].map((index) => ({
				sourceConnectionKey: SOURCE,
				sourceRecordKey: `GONE000${index}`,
				code: "custom",
				message: `Unexpected problem ${index}`,
				updatedAt: new Date(Date.UTC(2026, 8, index)),
			})),
		);
		// An edited record kept after its source stopped returning it.
		await db.insert(sourceRecordIssue).values({
			sourceConnectionKey: SOURCE,
			sourceRecordKey: "KEPT0001",
			code: "source_membership_removed",
			message: "This edited record no longer matches any connected OpenAlex search.",
		});

		const counts = async () =>
			Object.fromEntries((await getAdminSourceIssueTypes(db, SOURCE)).map((type) => [type.key, type.count]));
		expect(await counts()).toEqual({
			fields: 1,
			"pdf-not-uploaded": 1,
			"pdf-link-without-url": 1,
			"pdf-missing": 1,
			"no-longer-matched": 1,
			other: 3,
		});

		const fields = await getAdminSourceIssuePage(db, SOURCE, "fields", pages);
		expect(fields).toEqual({
			count: 1,
			issues: [
				{
					detail: "Abstract, Extra",
					itemKey: expect.any(String),
					links: [
						{ kind: "zotero-app", href: "zotero://select/groups/2129771/items/FIELDS11" },
						{ kind: "zotero-web", href: "https://www.zotero.org/groups/2129771/items/FIELDS11" },
						{ kind: "public", href: `/lib/${fields.issues[0]!.itemKey}` },
					],
					message: expect.stringContaining("left out"),
					meta: "Piper et al. 2018",
					sourceRecordKey: "FIELDS11",
					title: "Scaling up successfully",
				},
			],
		});
		// A record with a hidden tag has no public page.
		const [hidden] = (await getAdminSourceIssuePage(db, SOURCE, "pdf-missing", pages)).issues;
		expect(hidden?.links.map(({ kind }) => kind)).toEqual(["zotero-app", "zotero-web"]);

		const other = await getAdminSourceIssuePage(db, SOURCE, "other", { offset: 1, limit: 1 });
		expect(other).toEqual({
			count: 3,
			issues: [
				expect.objectContaining({
					detail: "Unexpected problem 2",
					itemKey: null,
					meta: null,
					sourceRecordKey: "GONE0002",
					title: "GONE0002",
				}),
			],
		});

		// A personal library's web address comes from Zotero's own response.
		await db.insert(sourceConnection).values({ key: "zotero-user", provider: "zotero", scopeKind: "personal-library", externalScopeKey: "475425" });
		await writeSourceIngestionBatch(db, {
			sourceConnectionKey: "zotero-user",
			expectedCursor: {},
			nextCursor: { libraryVersion: 1 },
			mappingProfileVersion: "test",
			fetchedAt: new Date(),
			collections: [],
			items: [
				{
					...report("USER1111", "Personal report", { code: "zotero_fields_dropped", message: "Some fields could not be stored and were left out: extra (Too long)." }),
					raw: { key: "USER1111", version: 1, links: { alternate: { href: "https://www.zotero.org/someone/items/USER1111" } } },
				},
			],
		});
		const [personal] = (await getAdminSourceIssuePage(db, "zotero-user", "fields", pages)).issues;
		expect(personal?.links.slice(0, 2)).toEqual([
			{ kind: "zotero-app", href: "zotero://select/library/items/USER1111" },
			{ kind: "zotero-web", href: "https://www.zotero.org/someone/items/USER1111" },
		]);

		const byType = await dismissAdminSourceIssues(db, SOURCE, { type: "pdf-not-uploaded" });
		expect(byType.count).toBe(1);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect((await dismissAdminSourceIssues(db, SOURCE, { record: "HIDDEN44" })).count).toBe(1);
		expect(await counts()).toEqual({ fields: 1, "pdf-link-without-url": 1, "no-longer-matched": 1, other: 3 });

		// Undo opens again what that one dismissal closed, and nothing else.
		expect(await restoreAdminSourceIssues(db, SOURCE, byType.batch)).toEqual({ count: 1 });
		expect(await counts()).toEqual({ fields: 1, "pdf-not-uploaded": 1, "pdf-link-without-url": 1, "no-longer-matched": 1, other: 3 });
	});
});
