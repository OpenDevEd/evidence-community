import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveItemDraft = vi.fn();

vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: vi.fn(async () => ({})),
}));
vi.mock("@/db", () => ({ getDatabase: vi.fn(async () => ({})) }));
vi.mock("@/lib/admin/file-runtime", () => ({
	getNativeFileRuntime: vi.fn(),
}));
vi.mock("@/lib/admin/http", () => ({
	ADMIN_RESPONSE_HEADERS: { "Cache-Control": "no-store" },
	adminErrorResponse: vi.fn((error: unknown) => {
		throw error;
	}),
	readAdminJson: vi.fn(async (request: NextRequest) => request.json()),
	requireAdminSession: vi.fn(async () => null),
}));
vi.mock("@/lib/admin/native-item-service", () => ({
	discardItemDraft: vi.fn(),
	getItemDraft: vi.fn(),
	openItemDraft: vi.fn(),
	saveItemDraft,
}));

describe("admin draft route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		saveItemDraft.mockResolvedValue({
			draftRevision: 2,
			itemKey: "ABCD2345",
			payload: {
				itemType: "Book",
				languageName: "French",
				title: "A book",
			},
		});
	});

	it("returns canonical storage fields using the editor's field names", async () => {
		const { PUT } = await import("@/app/api/admin/items/[key]/draft/route");
		const response = await PUT(
			new NextRequest("https://library.example.org/api/admin/items/ABCD2345/draft", {
				body: JSON.stringify({
					expectedDraftRevision: 1,
					expectedPayload: { itemType: "Book", language: "English" },
					payload: { itemType: "Book", language: "French" },
				}),
				headers: { "content-type": "application/json" },
				method: "PUT",
			}),
			{ params: Promise.resolve({ key: "ABCD2345" }) },
		);
		const body = (await response.json()) as {
			draft: { payload: Record<string, unknown> };
		};

		expect(body.draft.payload).toMatchObject({
			itemType: "Book",
			language: "French",
			title: "A book",
		});
		expect(body.draft.payload).not.toHaveProperty("languageName");
	});
});
