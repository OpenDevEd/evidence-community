// @vitest-environment jsdom

import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig, unstable_serialize, type Cache } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminPublicationView } from "@/lib/publication/admin-publication-view";

const api = vi.hoisted(() => ({
	activateCrossref: vi.fn(),
	activateZenodo: vi.fn(),
	get: vi.fn(),
	retryCrossref: vi.fn(),
	retryZenodo: vi.fn(),
}));

vi.mock("@/components/admin/admin-api", async (importOriginal) => ({
	...(await importOriginal()),
	activateAdminCrossrefPublication: api.activateCrossref,
	activateAdminZenodoPublication: api.activateZenodo,
	getAdminPublication: api.get,
	retryAdminCrossrefPublication: api.retryCrossref,
	retryAdminZenodoPublication: api.retryZenodo,
}));

import { AdminApiError } from "@/components/admin/admin-api";
import { useAdminPublication } from "@/components/admin/useAdminPublication";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function publication(
	itemKey: string,
	state: "inactive" | "queued" | "synced" = "inactive",
): AdminPublicationView {
	const shouldPoll = state === "queued";
	const provider = (name: "crossref" | "zenodo") => ({
		provider: name,
		environment: name === "crossref" ? "test" : "sandbox",
		displayState: state,
		status: { label: state, description: state, shouldPoll },
		waitingOn: null,
		blockers: [],
		externalDoi: null,
		capabilities: {
			canActivate: state === "inactive",
			canRetry: false,
			actionLabel: "Activate",
			allowedIdentifierPolicies: name === "zenodo" ? ["mint-zenodo"] : [],
		},
		exact: {
			targetActive: state !== "inactive",
			target: null,
			identifierPolicy: null,
			plan: { status: "skipped", reason: null, operations: [] },
			job: null,
			recentJobs: [],
			identifiers: [],
			pending: false,
			pendingSubmission: null,
			journal: false,
			failure: null,
		},
		links: [],
	});
	return {
		itemKey,
		canonicalRevision: 1,
		bibliographicDoi: { status: "none", doi: null, sources: [], conflicts: [] },
		doiNamespace: { prefix: "10.5555", suffixNamespace: "library." },
		providers: {
			crossref: provider("crossref"),
			zenodo: provider("zenodo"),
		},
	} as unknown as AdminPublicationView;
}

type Hook = ReturnType<typeof useAdminPublication>;

async function flush() {
	for (let index = 0; index < 12; index += 1) await Promise.resolve();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe("useAdminPublication", () => {
	let container: HTMLDivElement;
	let cache: Cache<AdminPublicationView>;
	let current: Hook;
	let inputVersion = "1";
	let itemKey = "ABCDEFGH";
	let root: Root;

	function Harness() {
		const value = useAdminPublication(itemKey, inputVersion);
		useLayoutEffect(() => {
			current = value;
		}, [value]);
		return null;
	}

	async function render() {
		await act(async () => {
			root.render(
				<SWRConfig
					value={{
						dedupingInterval: 0,
						errorRetryCount: 0,
						provider: () => cache,
					}}
				>
					<Harness />
				</SWRConfig>,
			);
			await flush();
		});
	}

	beforeEach(() => {
		inputVersion = "1";
		itemKey = "ABCDEFGH";
		for (const mock of Object.values(api)) mock.mockReset();
		api.get.mockImplementation(async (key: string) => publication(key));
		cache = new Map();
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.useRealTimers();
	});

	it("loads the selected item without keeping the previous item on screen", async () => {
		await render();
		expect(current.publication?.itemKey).toBe("ABCDEFGH");

		let resolveNext!: (value: AdminPublicationView) => void;
		api.get.mockImplementationOnce(
			() => new Promise((resolve) => (resolveNext = resolve)),
		);
		itemKey = "HGFEDCBA";
		await act(async () => {
			root.render(
				<SWRConfig value={{ dedupingInterval: 0, provider: () => cache }}>
					<Harness />
				</SWRConfig>,
			);
			await Promise.resolve();
		});
		expect(current.publication).toBeNull();

		await act(async () => {
			resolveNext(publication("HGFEDCBA"));
			await flush();
		});
		expect(current.publication?.itemKey).toBe("HGFEDCBA");
	});

	it("reloads publication details when the published input version changes", async () => {
		api.get
			.mockResolvedValueOnce(publication("ABCDEFGH", "queued"))
			.mockResolvedValueOnce(publication("ABCDEFGH", "inactive"));
		await render();
		expect(current.publication?.providers.crossref.displayState).toBe(
			"queued",
		);

		inputVersion = "2";
		await act(async () => {
			root.render(
				<SWRConfig value={{ dedupingInterval: 0, provider: () => cache }}>
					<Harness />
				</SWRConfig>,
			);
			await flush();
		});

		expect(api.get).toHaveBeenCalledTimes(2);
		expect(current.publication?.providers.crossref.displayState).toBe(
			"inactive",
		);
	});

	it("polls transitional state and stops after the server reports synced", async () => {
		vi.useFakeTimers();
		api.get
			.mockResolvedValueOnce(publication("ABCDEFGH", "queued"))
			.mockResolvedValue(publication("ABCDEFGH", "synced"));
		await act(async () => {
			root.render(
				<SWRConfig value={{ dedupingInterval: 0, provider: () => cache }}>
					<Harness />
				</SWRConfig>,
			);
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(current.publication?.providers.crossref.displayState).toBe("queued");

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1_000);
		});
		expect(current.publication?.providers.crossref.displayState).toBe("synced");
		const callsAfterSync = api.get.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5_000);
		});
		expect(api.get).toHaveBeenCalledTimes(callsAfterSync);
	});

	it("seeds the shared view after activation and ignores a duplicate click", async () => {
		let finish!: (value: { publication: AdminPublicationView }) => void;
		api.activateCrossref.mockImplementation(
			() => new Promise((resolve) => (finish = resolve)),
		);
		await render();

		let first!: Promise<boolean>;
		let second!: Promise<boolean>;
		await act(async () => {
			first = current.activateCrossref();
			second = current.activateCrossref();
			await Promise.resolve();
		});
		expect(api.activateCrossref).toHaveBeenCalledTimes(1);
		await expect(second).resolves.toBe(false);

		await act(async () => {
			finish({ publication: publication("ABCDEFGH", "queued") });
			await first;
			await flush();
		});
		expect(current.publication?.providers.crossref.displayState).toBe("queued");
		expect(current.actionError).toBeNull();
	});

	it("seeds a completed action under the item where it started", async () => {
		let finishActivation!: (value: { publication: AdminPublicationView }) => void;
		let finishSecondItem!: (value: AdminPublicationView) => void;
		api.activateCrossref.mockImplementation(
			() => new Promise((resolve) => (finishActivation = resolve)),
		);
		api.get.mockImplementation((key: string) =>
			key === "ABCDEFGH"
				? Promise.resolve(publication(key))
				: new Promise((resolve) => (finishSecondItem = resolve)),
		);
		await render();

		let activation!: Promise<boolean>;
		await act(async () => {
			activation = current.activateCrossref();
			await Promise.resolve();
		});
		itemKey = "HGFEDCBA";
		await act(async () => {
			root.render(
				<SWRConfig value={{ dedupingInterval: 0, provider: () => cache }}>
					<Harness />
				</SWRConfig>,
			);
			await Promise.resolve();
		});

		await act(async () => {
			finishActivation({ publication: publication("ABCDEFGH", "queued") });
			await activation;
			await Promise.resolve();
		});
		expect(current.publication).toBeNull();
		expect(
			cache.get(
				unstable_serialize(["admin-publication", "ABCDEFGH", "1"]),
			)?.data?.providers.crossref.displayState,
		).toBe("queued");

		await act(async () => {
			finishSecondItem(publication("HGFEDCBA", "synced"));
			await flush();
		});
		expect(current.publication?.itemKey).toBe("HGFEDCBA");
		expect(current.publication?.providers.crossref.displayState).toBe("synced");
	});

	it("keeps human validation details with the selected item", async () => {
		api.activateZenodo.mockRejectedValue(
			new AdminApiError(
				{
					code: "validation_failed",
					message: "Complete the required Zenodo fields and try again.",
					fields: { abstractNote: "Add an abstract or description." },
				},
				400,
			),
		);
		await render();

		await act(async () => {
			await current.activateZenodo("mint-zenodo");
			await flush();
		});
		expect(api.get).toHaveBeenCalledTimes(2);
		expect(current.actionError).toBe(
			"Complete the required Zenodo fields and try again.",
		);
		expect(current.actionFieldErrors).toEqual({
			abstractNote: "Add an abstract or description.",
		});

		itemKey = "HGFEDCBA";
		await act(async () => {
			root.render(
				<SWRConfig value={{ dedupingInterval: 0, provider: () => cache }}>
					<Harness />
				</SWRConfig>,
			);
			await flush();
		});
		expect(current.actionError).toBeNull();
		expect(current.actionFieldErrors).toEqual({});
	});
});
