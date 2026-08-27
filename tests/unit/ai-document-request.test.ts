import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => {
	class AIProviderUnavailableError extends Error {}
	return {
		AIProviderUnavailableError,
		getAIProviderForConfig: vi.fn(),
		getCachedItem: vi.fn(),
		getLibraryConfig: vi.fn(),
		isAIAllowed: vi.fn(),
		isLibraryFeatureEnabled: vi.fn(),
	};
});

vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: harness.getLibraryConfig,
}));
vi.mock("@/config/library-config/features", () => ({
	isLibraryFeatureEnabled: harness.isLibraryFeatureEnabled,
}));
vi.mock("@/lib/ai-provider", () => ({
	AIProviderUnavailableError: harness.AIProviderUnavailableError,
	getAIProviderForConfig: harness.getAIProviderForConfig,
}));
vi.mock("@/lib/utils", () => ({ isAIAllowed: harness.isAIAllowed }));
vi.mock("@/app/api/cache", () => ({ getCachedItem: harness.getCachedItem }));

import { prepareDocumentAIRequest } from "@/app/api/ai/document-request";

function responseStatus(
	result: Awaited<ReturnType<typeof prepareDocumentAIRequest>>,
) {
	if (!("response" in result) || !result.response) {
		throw new Error("Expected an error response");
	}
	return result.response.status;
}

const config = {
	features: { ai: true },
	revision: "analytics-document-request",
	updatedAt: "2026-08-27T12:00:00.000Z",
};
const models = { defaultModel: "model" };
const item = {
	item: {
		key: "ITEM1",
		title: "A publication",
		fullTextPDFs: [{ key: "PDF1", fullTextPDF: [] }],
	},
};

describe("document AI request preparation", () => {
	beforeEach(() => {
		harness.getLibraryConfig.mockReset().mockResolvedValue(config);
		harness.isLibraryFeatureEnabled.mockReset().mockReturnValue(true);
		harness.getCachedItem.mockReset().mockResolvedValue(item);
		harness.getAIProviderForConfig.mockReset().mockResolvedValue(models);
		harness.isAIAllowed.mockReset().mockReturnValue(true);
	});

	it("returns the shared item, model, and runtime context", async () => {
		const result = await prepareDocumentAIRequest("ITEM1", "openai");

		expect(result).toEqual({
			cleanItem: { key: "ITEM1", title: "A publication" },
			fullTextPDFs: item.item.fullTextPDFs,
			libraryConfig: config,
			models,
		});
		expect(harness.getCachedItem).toHaveBeenCalledWith("ITEM1");
	});

	it("rejects a disabled feature before reading an item", async () => {
		harness.isLibraryFeatureEnabled.mockReturnValue(false);

		const result = await prepareDocumentAIRequest("ITEM1", "openai");

		expect(responseStatus(result)).toBe(403);
		expect(harness.getCachedItem).not.toHaveBeenCalled();
	});

	it("rejects a missing or unknown item", async () => {
		harness.getCachedItem.mockResolvedValue(null);

		const missingKey = await prepareDocumentAIRequest(null, "openai");
		const unknownItem = await prepareDocumentAIRequest("MISSING", "openai");

		expect(responseStatus(missingKey)).toBe(404);
		expect(responseStatus(unknownItem)).toBe(404);
	});

	it("returns a clear error when the selected provider is unavailable", async () => {
		harness.getAIProviderForConfig.mockRejectedValue(
			new harness.AIProviderUnavailableError("unavailable"),
		);

		const result = await prepareDocumentAIRequest("ITEM1", "openai");

		expect(responseStatus(result)).toBe(404);
	});

	it("does not pass restricted records to a model", async () => {
		harness.isAIAllowed.mockReturnValue(false);

		const result = await prepareDocumentAIRequest("ITEM1", "openai");

		expect(responseStatus(result)).toBe(403);
	});

	it("does not hide unexpected provider failures", async () => {
		const failure = new Error("provider configuration failed");
		harness.getAIProviderForConfig.mockRejectedValue(failure);

		await expect(prepareDocumentAIRequest("ITEM1", "openai")).rejects.toBe(
			failure,
		);
	});
});
