import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
	RevisionAwarePostHogFactory,
	type PostHogClient,
	type PostHogClientFactory,
} from "@/lib/posthog-factory";
import { RevisionResourceConflictError } from "@/lib/revision-aware-resource";

function request({
	host = "https://analytics.example.org",
	key = "phc_1234567890123456",
	revision,
	updatedAt,
}: {
	host?: string;
	key?: string;
	revision: string;
	updatedAt: string;
}) {
	return {
		configuration: { host, key },
		revision,
		updatedAt,
	};
}

function clientFactory() {
	const clients: Array<PostHogClient & { host: string; key: string }> = [];
	const factory = vi.fn<PostHogClientFactory>((key, options) => {
		const client = {
			capture: vi.fn(),
			host: options.host,
			key,
			shutdown: vi.fn(async () => undefined),
		};
		clients.push(client);
		return client;
	});

	return { clients, factory };
}

describe("revision-aware PostHog factory", () => {
	it("does not create a client when PostHog is not configured", async () => {
		const { factory } = clientFactory();
		const posthog = new RevisionAwarePostHogFactory(factory);

		const client = await posthog.get({
			configuration: {},
			revision: "posthog-disabled",
			updatedAt: "2026-07-28T10:00:00.000Z",
		});

		expect(client).toBeNull();
		expect(factory).not.toHaveBeenCalled();
	});

	it("creates and reuses the configured client for one revision", async () => {
		const { clients, factory } = clientFactory();
		const posthog = new RevisionAwarePostHogFactory(factory);
		const config = request({
			revision: "posthog-one",
			updatedAt: "2026-07-28T10:01:00.000Z",
		});

		const first = await posthog.get(config);
		const second = await posthog.get(config);

		expect(first).toBe(second);
		expect(factory).toHaveBeenCalledOnce();
		expect(factory).toHaveBeenCalledWith(
			"phc_1234567890123456",
			{
				flushAt: 1,
				flushInterval: 0,
				host: "https://analytics.example.org",
			},
		);
		expect(clients[0]).toMatchObject({
			host: "https://analytics.example.org",
			key: "phc_1234567890123456",
		});
	});

	it("replaces and shuts down the client for a newer revision", async () => {
		const { clients, factory } = clientFactory();
		const posthog = new RevisionAwarePostHogFactory(factory);
		const first = await posthog.get(
			request({
				revision: "posthog-two",
				updatedAt: "2026-07-28T10:02:00.000Z",
			}),
		);
		const second = await posthog.get(
			request({
				host: "https://analytics-two.example.org",
				key: "phc_abcdefghijklmnop",
				revision: "posthog-three",
				updatedAt: "2026-07-28T10:03:00.000Z",
			}),
		);

		expect(second).not.toBe(first);
		expect(factory).toHaveBeenCalledTimes(2);
		await vi.waitFor(() => {
			expect(clients[0].shutdown).toHaveBeenCalledOnce();
		});
	});

	it("rejects changed PostHog settings under one revision", async () => {
		const { factory } = clientFactory();
		const posthog = new RevisionAwarePostHogFactory(factory);
		await posthog.get(
			request({
				revision: "posthog-four",
				updatedAt: "2026-07-28T10:04:00.000Z",
			}),
		);

		await expect(
			posthog.get(
				request({
					host: "https://changed.example.org",
					revision: "posthog-four",
					updatedAt: "2026-07-28T10:04:00.000Z",
				}),
			),
		).rejects.toBeInstanceOf(RevisionResourceConflictError);
	});
});
