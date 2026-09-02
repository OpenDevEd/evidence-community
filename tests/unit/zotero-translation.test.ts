import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
	getZoteroExportUrl,
	translateZoteroItemToCSL,
	ZoteroTranslationError,
} from "@/lib/zotero-translation";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("runtime Zotero translation", () => {
	it("builds the export endpoint from a configured service base path", () => {
		expect(
			getZoteroExportUrl(
				"http://translation-server:1969/internal/zotero/",
				"csljson",
			).toString(),
		).toBe(
			"http://translation-server:1969/internal/zotero/export?format=csljson",
		);
	});

	it("posts Zotero JSON to the configured runtime service", async () => {
		const fetchTranslation = vi.fn().mockResolvedValue(
			Response.json([
				{
					id: "ITEM01",
					title: "Runtime translation",
				},
			]),
		);
		vi.stubGlobal("fetch", fetchTranslation);

		await expect(
			translateZoteroItemToCSL(
				{
					key: "ITEM01",
					itemType: "journalArticle",
					title: "Runtime translation",
				},
				"ITEM01",
				"http://translation-server:1969",
			),
		).resolves.toEqual({
			id: "ITEM01",
			title: "Runtime translation",
		});

		expect(String(fetchTranslation.mock.calls[0]?.[0])).toBe(
			"http://translation-server:1969/export?format=csljson",
		);
		expect(fetchTranslation.mock.calls[0]?.[1]).toMatchObject(
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify([
					{
						key: "ITEM01",
						itemType: "journalArticle",
						title: "Runtime translation",
					},
				]),
			},
		);
	});

	it("returns null without contacting an absent optional service", async () => {
		const fetchTranslation = vi.fn();
		vi.stubGlobal("fetch", fetchTranslation);

		await expect(
			translateZoteroItemToCSL(
				{ key: "ITEM01" },
				"ITEM01",
				undefined,
			),
		).resolves.toBeNull();
		expect(fetchTranslation).not.toHaveBeenCalled();
	});

	it("keeps blank CSL items eligible for citeproc", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				Response.json([
					{
						id: "ITEM01",
					},
				]),
			),
		);

		await expect(
			translateZoteroItemToCSL(
				{ key: "ITEM01" },
				"ITEM01",
				"http://translation-server:1969",
			),
		).resolves.toEqual({
			id: "ITEM01",
			title: "Untitled",
		});
	});

	it("returns null for a successful empty translation", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(Response.json([])),
		);

		await expect(
			translateZoteroItemToCSL(
				{ key: "ITEM01" },
				"ITEM01",
				"http://translation-server:1969",
			),
		).resolves.toBeNull();
	});

	it("reports non-successful upstream responses explicitly", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response("Unavailable", { status: 503 }),
			),
		);

		await expect(
			translateZoteroItemToCSL(
				{ key: "ITEM01" },
				"ITEM01",
				"http://translation-server:1969",
			),
		).rejects.toMatchObject({
			code: "TRANSLATION_REQUEST_FAILED",
			status: 503,
		} satisfies Partial<ZoteroTranslationError>);
	});

	it("reports invalid upstream JSON explicitly", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response("not-json", {
					headers: {
						"Content-Type": "application/json",
					},
				}),
			),
		);

		await expect(
			translateZoteroItemToCSL(
				{ key: "ITEM01" },
				"ITEM01",
				"http://translation-server:1969",
			),
		).rejects.toMatchObject({
			code: "TRANSLATION_RESPONSE_INVALID",
			status: 200,
		} satisfies Partial<ZoteroTranslationError>);
	});

	it("rejects malformed successful responses explicitly", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(Response.json({ id: "ITEM01" })),
		);

		await expect(
			translateZoteroItemToCSL(
				{ key: "ITEM01" },
				"ITEM01",
				"http://translation-server:1969",
			),
		).rejects.toMatchObject({
			code: "TRANSLATION_RESPONSE_INVALID",
			status: 200,
		} satisfies Partial<ZoteroTranslationError>);
	});
});
