import { describe, expect, it } from "vitest";

import type { Collection } from "@/app/api/collections/types";
import {
	applyRuntimeCollectionConfiguration,
	RuntimeCollectionConfigurationError,
} from "@/lib/collections";

const timestamp = new Date("2026-07-28T00:00:00.000Z");

function collection(
	key: string,
	parentCollection: string | null = null,
	name = key,
): Collection {
	return {
		id: `00000000-0000-0000-0000-${key.padEnd(12, "0").slice(0, 12)}`,
		key,
		version: 1,
		numCollections: 0,
		numItems: 1,
		name,
		deleted: 0,
		parentCollection,
		groupExternalId: 1,
		relations: null,
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

describe("runtime collection configuration", () => {
	it("applies configured title, enabled state, and order without mutating database rows", () => {
		const databaseCollections = [
			collection("root-b", null, "Database B"),
			collection("child-a", "root-a", "Child A"),
			collection("root-a", null, "Database A"),
			collection("root-c", null, "Database C"),
		];
		const original = structuredClone(databaseCollections);

		const result = applyRuntimeCollectionConfiguration(
			databaseCollections,
			[
				{
					id: "root-b",
					title: "Configured B",
					enabled: true,
					order: 20,
				},
				{
					id: "root-a",
					title: "Configured A",
					enabled: true,
					order: 10,
				},
				{
					id: "root-c",
					enabled: false,
					order: 0,
				},
			],
		);

		expect(result.map(({ key }) => key)).toEqual([
			"root-a",
			"child-a",
			"root-b",
		]);
		expect(result.find(({ key }) => key === "root-a")?.title).toBe(
			"Configured A",
		);
		expect(result.find(({ key }) => key === "child-a")).toMatchObject({
			title: "Configured A",
			originalFacet: "root-a",
		});
		expect(result.find(({ key }) => key === "root-b")?.title).toBe(
			"Configured B",
		);
		expect(databaseCollections).toEqual(original);
	});

	it("uses database names when no configured title is provided", () => {
		const result = applyRuntimeCollectionConfiguration(
			[collection("root-a", null, "Database title")],
			[{ id: "root-a", enabled: true }],
		);

		expect(result[0]?.title).toBe("Database title");
	});

	it("removes an explicitly disabled nested collection and its descendants", () => {
		const result = applyRuntimeCollectionConfiguration(
			[
				collection("root-a"),
				collection("child-a", "root-a"),
				collection("grandchild-a", "child-a"),
				collection("child-b", "root-a"),
			],
			[
				{ id: "root-a", enabled: true },
				{ id: "child-a", enabled: false },
			],
		);

		expect(result.map(({ key }) => key)).toEqual([
			"root-a",
			"child-b",
		]);
	});

	it("resolves duplicate explicit order values by collection ID", () => {
		const result = applyRuntimeCollectionConfiguration(
			[collection("root-b"), collection("root-a")],
			[
				{ id: "root-b", enabled: true, order: 10 },
				{ id: "root-a", enabled: true, order: 10 },
			],
		);

		expect(result.map(({ key }) => key)).toEqual(["root-a", "root-b"]);
	});

	it("rejects configured IDs that are absent from the database", () => {
		expect(() =>
			applyRuntimeCollectionConfiguration(
				[collection("root-a")],
				[
					{ id: "missing-b", enabled: false },
					{ id: "missing-a", enabled: true },
				],
			),
		).toThrowError(
			new RuntimeCollectionConfigurationError([
				"missing-a",
				"missing-b",
			]),
		);
	});
});
