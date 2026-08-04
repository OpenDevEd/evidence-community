import {
	MeilisearchRequestError,
	MeilisearchRequestTimeOutError,
} from "meilisearch";
import { describe, expect, it, vi } from "vitest";

import { RevisionAwareMeilisearchFactory } from "@/lib/meilisearch-factory";
import { installProcessFetchAbortSignal } from "@/lib/process-fetch-signal";
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
	it("retains the SDK request timeout while shutdown cancellation is installed", async () => {
		const controller = new AbortController();
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation((_input, init) => {
				return new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => reject(init.signal?.reason),
						{ once: true },
					);
				});
			});
		const restoreFetchSignal = installProcessFetchAbortSignal(
			controller.signal,
		);

		try {
			const factory = new RevisionAwareMeilisearchFactory({
				requestTimeoutMs: 100,
			});
			const service = await factory.get(
				request({
					index: "library_timeout",
					revision: "search-factory-timeout",
					updatedAt: "2026-07-28T03:59:00.000Z",
				}),
			);

			try {
				await service.client.getRawIndex("library_timeout");
				throw new Error("The stalled request ignored its timeout");
			} catch (error) {
				expect(error).toBeInstanceOf(MeilisearchRequestError);
				expect((error as Error).cause).toBeInstanceOf(
					MeilisearchRequestTimeOutError,
				);
			}
			expect(controller.signal.aborted).toBe(false);
		} finally {
			restoreFetchSignal();
			fetchMock.mockRestore();
		}
	});

	it("propagates a worker shutdown signal into every HTTP request", async () => {
		const controller = new AbortController();
		const requestSignals: Array<AbortSignal | null | undefined> = [];
		let markRequestStarted!: () => void;
		const requestStarted = new Promise<void>((resolve) => {
			markRequestStarted = resolve;
		});
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation((_input, init) => {
				const requestSignal = init?.signal;
				requestSignals.push(requestSignal);
				if (requestSignals.length === 5) markRequestStarted();
				return new Promise<Response>((_resolve, reject) => {
					requestSignal?.addEventListener(
						"abort",
						() => reject(requestSignal?.reason),
						{ once: true },
					);
				});
			});
		let restoreFetchSignal: () => void = () => undefined;

		try {
			restoreFetchSignal = installProcessFetchAbortSignal(
				controller.signal,
			);
			const factory = new RevisionAwareMeilisearchFactory();
			const service = await factory.get(
				request({
					index: "library_abort",
					revision: "search-factory-abort",
					updatedAt: "2026-07-28T04:00:00.000Z",
				}),
			);
			const requests = [
				service.index.addDocuments([{ key: "ABRT2345" }]),
				service.index.deleteDocuments(["ABRT2345"]),
				service.index.updateSettings({ sortableAttributes: ["title"] }),
				service.client.batches.getBatch(73),
				service.client.getRawIndex("library_abort"),
			];
			await requestStarted;
			controller.abort();

			const results = await Promise.allSettled(requests);
			expect(results.every(({ status }) => status === "rejected")).toBe(
				true,
			);
			expect(
				requestSignals.every((requestSignal) => requestSignal?.aborted),
			).toBe(true);
		} finally {
			restoreFetchSignal();
			fetchMock.mockRestore();
		}
	});

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
