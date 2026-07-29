import { describe, expect, it } from "vitest";

import { RevisionAwareFileStorageFactory } from "@/lib/admin/file-storage";
import { RevisionResourceConflictError } from "@/lib/revision-aware-resource";

function request({
	privateBucket = "library-private",
	revision,
	updatedAt,
}: {
	privateBucket?: string;
	revision: string;
	updatedAt: string;
}) {
	return {
		configuration: {
			url: "http://storage:5000",
			serviceRoleKey: "service-role-key",
			privateBucket,
			publicBucket: "library-public",
			maxPdfBytes: 100_000_000,
		},
		revision,
		updatedAt,
	};
}

describe("revision-aware file storage factory", () => {
	it("reuses a storage client for one configuration revision", async () => {
		const factory = new RevisionAwareFileStorageFactory();
		const config = request({
			revision: "storage-one",
			updatedAt: "2026-07-29T15:00:00.000Z",
		});

		expect(await factory.get(config)).toBe(await factory.get(config));
	});

	it("replaces storage for a newer configuration revision", async () => {
		const factory = new RevisionAwareFileStorageFactory();
		const first = await factory.get(
			request({
				revision: "storage-two",
				updatedAt: "2026-07-29T15:01:00.000Z",
			}),
		);
		const second = await factory.get(
			request({
				privateBucket: "library-private-next",
				revision: "storage-three",
				updatedAt: "2026-07-29T15:02:00.000Z",
			}),
		);

		expect(second).not.toBe(first);
	});

	it("rejects storage changes under the same revision", async () => {
		const factory = new RevisionAwareFileStorageFactory();
		await factory.get(
			request({
				revision: "storage-four",
				updatedAt: "2026-07-29T15:03:00.000Z",
			}),
		);

		await expect(
			factory.get(
				request({
					privateBucket: "changed-private",
					revision: "storage-four",
					updatedAt: "2026-07-29T15:03:00.000Z",
				}),
			),
		).rejects.toBeInstanceOf(RevisionResourceConflictError);
	});
});
