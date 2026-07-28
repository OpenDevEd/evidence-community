import { describe, expect, it } from "vitest";

import { RevisionAwareMeilisearchFactory } from "@/lib/meilisearch-factory";
import { RevisionResourceConflictError } from "@/lib/revision-aware-resource";

function request({
	host = "http://meilisearch:7700",
	index,
	key = "master-key",
	revision,
	updatedAt,
}: {
	host?: string;
	index: string;
	key?: string;
	revision: string;
	updatedAt: string;
}) {
	return {
		configuration: { host, index, key },
		revision,
		updatedAt,
	};
}

describe("revision-aware Meilisearch factory", () => {
	it("reuses the service and configured index for one revision", async () => {
		const factory = new RevisionAwareMeilisearchFactory();
		const libraryConfig = request({
			index: "library_one",
			revision: "search-factory-one",
			updatedAt: "2026-07-28T04:00:00.000Z",
		});

		const first = await factory.get(libraryConfig);
		const second = await factory.get(libraryConfig);

		expect(first).toBe(second);
		expect(first.indexName).toBe("library_one");
		expect(first.index.uid).toBe("library_one");
	});

	it("replaces the service and index for a newer revision", async () => {
		const factory = new RevisionAwareMeilisearchFactory();
		const first = await factory.get(
			request({
				index: "library_two",
				revision: "search-factory-two",
				updatedAt: "2026-07-28T04:01:00.000Z",
			}),
		);
		const second = await factory.get(
			request({
				index: "library_three",
				revision: "search-factory-three",
				updatedAt: "2026-07-28T04:02:00.000Z",
			}),
		);

		expect(second).not.toBe(first);
		expect(first.index.uid).toBe("library_two");
		expect(second.index.uid).toBe("library_three");
		expect(second.index).not.toBe(first.index);
	});

	it("rejects search settings changed under the same revision", async () => {
		const factory = new RevisionAwareMeilisearchFactory();
		await factory.get(
			request({
				index: "library_four",
				revision: "search-factory-four",
				updatedAt: "2026-07-28T04:03:00.000Z",
			}),
		);

		await expect(
			factory.get(
				request({
					index: "library_five",
					revision: "search-factory-four",
					updatedAt: "2026-07-28T04:03:00.000Z",
				}),
			),
		).rejects.toBeInstanceOf(RevisionResourceConflictError);
	});
});
