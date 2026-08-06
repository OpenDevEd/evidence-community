import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
	ZOTERO_PLAYGROUND,
	ZoteroPlaygroundSeeder,
	collectZoteroPages,
	createFixturePdf,
	editableFieldsMatch,
	fileUploadPrecondition,
	fixtureIdFromItem,
	indexFixtureItems,
} from "../../tools/seedZoteroPlayground";

function validKey(overrides: Record<string, unknown> = {}) {
	return {
		access: {
			groups: {
				[ZOTERO_PLAYGROUND.groupId]: { library: true, write: true },
			},
		},
		userID: ZOTERO_PLAYGROUND.ownerUserId,
		username: ZOTERO_PLAYGROUND.ownerUsername,
		...overrides,
	};
}

function validGroup(overrides: Record<string, unknown> = {}) {
	return {
		data: {
			name: ZOTERO_PLAYGROUND.groupName,
			owner: ZOTERO_PLAYGROUND.ownerUserId,
			...overrides,
		},
	};
}

function targetFetch(options: {
	group?: Record<string, unknown>;
	key?: Record<string, unknown>;
}) {
	return (async (input: string | URL | Request) =>
		new Response(
			JSON.stringify(
				String(input).endsWith("/keys/current")
					? validKey(options.key)
					: validGroup(options.group),
			),
		)) as typeof fetch;
}

function createSeeder(
	overrides: {
		fetch?: typeof fetch;
		sleep?: (milliseconds: number) => Promise<void>;
	} = {},
) {
	return new ZoteroPlaygroundSeeder({
		apiKey: "test-key",
		groupId: ZOTERO_PLAYGROUND.groupId,
		publishTag: "purple-publish",
		...overrides,
	});
}

describe("Zotero playground fixture safety", () => {
	it("refuses every group except the dedicated OpenScholar playground", () => {
		expect(
			() =>
				new ZoteroPlaygroundSeeder({
					apiKey: "test-key",
					groupId: "5964260",
					publishTag: "purple-publish",
				}),
		).toThrow(`expected dedicated playground ${ZOTERO_PLAYGROUND.groupId}`);
	});

	it("rejects keys without matching owner and write access before seeding", async () => {
		const fakeFetch = async (input: string | URL | Request) => {
			const url = String(input);
			if (url.endsWith("/keys/current")) {
				return new Response(
					JSON.stringify({
						access: {
							groups: { all: { library: true, write: false } },
						},
						userID: ZOTERO_PLAYGROUND.ownerUserId,
						username: ZOTERO_PLAYGROUND.ownerUsername,
					}),
				);
			}
			return new Response(
				JSON.stringify({
					data: {
						name: ZOTERO_PLAYGROUND.groupName,
						owner: ZOTERO_PLAYGROUND.ownerUserId,
					},
				}),
			);
		};
		const seeder = createSeeder({ fetch: fakeFetch as typeof fetch });
		await expect(seeder.verifyTarget()).rejects.toThrow(
			"grant library/write access",
		);
	});

	it.each([
		["wrong user ID", { userID: 42 }],
		["wrong username", { username: "personal-account" }],
	])("rejects %s before reading the group", async (_label, key) => {
		const requested: string[] = [];
		const fetchImplementation = targetFetch({ key });
		const seeder = createSeeder({
			fetch: (async (input, init) => {
				requested.push(String(input));
				return fetchImplementation(input, init);
			}) as typeof fetch,
		});
		await expect(seeder.verifyTarget()).rejects.toThrow(
			"must belong to opendeved",
		);
		expect(requested).toHaveLength(1);
	});

	it.each([
		["wrong group name", { name: "Production Library" }],
		["wrong group owner", { owner: 42 }],
	])("rejects %s", async (_label, group) => {
		const seeder = createSeeder({ fetch: targetFetch({ group }) });
		await expect(seeder.verifyTarget()).rejects.toThrow(
			"Refusing unexpected Zotero group",
		);
	});

	it("backs off exponentially when Retry-After is absent", async () => {
		let keyAttempts = 0;
		const sleeps: number[] = [];
		const seeder = createSeeder({
			fetch: (async (input) => {
				if (String(input).endsWith("/keys/current")) {
					keyAttempts += 1;
					if (keyAttempts === 1)
						return new Response("outage", { status: 503 });
					return new Response(JSON.stringify(validKey()));
				}
				return new Response(JSON.stringify(validGroup()));
			}) as typeof fetch,
			sleep: async (milliseconds) => {
				sleeps.push(milliseconds);
			},
		});
		await seeder.verifyTarget();
		expect(keyAttempts).toBe(2);
		expect(sleeps).toEqual([300]);
	});

	it("honors Retry-After and Backoff response headers", async () => {
		let keyAttempts = 0;
		const sleeps: number[] = [];
		const seeder = createSeeder({
			fetch: (async (input) => {
				if (String(input).endsWith("/keys/current")) {
					keyAttempts += 1;
					if (keyAttempts === 1) {
						return new Response("rate limited", {
							headers: { "retry-after": "2" },
							status: 429,
						});
					}
					return new Response(JSON.stringify(validKey()), {
						headers: { backoff: "3" },
					});
				}
				return new Response(JSON.stringify(validGroup()));
			}) as typeof fetch,
			sleep: async (milliseconds) => {
				sleeps.push(milliseconds);
			},
		});
		await seeder.verifyTarget();
		expect(sleeps).toEqual([2_000, 3_000]);
	});

	it("extracts exactly one stable fixture identity", () => {
		expect(
			fixtureIdFromItem({
				data: {
					tags: [
						{ tag: ZOTERO_PLAYGROUND.markerTag },
						{ tag: "openscholar-fixture:published-report" },
					],
				},
				key: "AAAA2345",
				version: 1,
			}),
		).toBe("published-report");
	});

	it("rejects ambiguous or duplicated fixture identities", () => {
		const record = {
			data: { tags: [{ tag: "openscholar-fixture:duplicate" }] },
			key: "AAAA2345",
			version: 1,
		};
		expect(() =>
			indexFixtureItems([record, { ...record, key: "BBBB2345" }]),
		).toThrow("Duplicate Zotero fixture ID");
		expect(() =>
			fixtureIdFromItem({
				...record,
				data: {
					tags: [
						{ tag: "openscholar-fixture:first" },
						{ tag: "openscholar-fixture:second" },
					],
				},
			}),
		).toThrow("multiple fixture IDs");
	});

	it("normalizes tag and collection ordering without hiding real edits", () => {
		const current = {
			collections: ["BBBB2345", "AAAA2345"],
			tags: [{ tag: "second", type: 1 }, { tag: "first" }],
			title: "Stable title",
		};
		expect(
			editableFieldsMatch(current, {
				collections: ["AAAA2345", "BBBB2345"],
				tags: [{ tag: "first" }, { tag: "second" }],
				title: "Stable title",
			}),
		).toBe(true);
		expect(editableFieldsMatch(current, { title: "Changed title" })).toBe(
			false,
		);
	});

	it("selects the correct file upload precondition", () => {
		expect(fileUploadPrecondition(null)).toEqual({ "If-None-Match": "*" });
		expect(fileUploadPrecondition("abc123")).toEqual({
			"If-Match": "abc123",
		});
	});

	it("collects exact and partial pages without dropping records", async () => {
		const starts: number[] = [];
		const records = await collectZoteroPages(async (start, limit) => {
			starts.push(start);
			const count = start === 0 ? limit : 2;
			return Array.from({ length: count }, (_, index) => ({
				data: {},
				key: `${start + index}`,
				version: 1,
			}));
		});
		expect(starts).toEqual([0, 100]);
		expect(records).toHaveLength(102);
	});
});

describe("Zotero playground PDF fixtures", () => {
	it("generates stable, multi-page, valid PDF bytes", async () => {
		const options = {
			documentTitle: "Fixture",
			pageTokens: ["PAGE-ONE", "PAGE-TWO"],
		};
		const first = await createFixturePdf(options);
		const second = await createFixturePdf(options);
		expect(new TextDecoder().decode(first.slice(0, 5))).toBe("%PDF-");
		expect(createHash("md5").update(first).digest("hex")).toBe(
			createHash("md5").update(second).digest("hex"),
		);
	});
});
