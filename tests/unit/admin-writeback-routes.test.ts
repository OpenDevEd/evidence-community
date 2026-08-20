import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const publishItemDraftWithContext = vi.fn();
const unpublishNativeItemWithOutcome = vi.fn();
const setAdminItemWritebackSources = vi.fn();
const resolveAdminSourceWritebackConflict = vi.fn();

vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig: vi.fn(async () => ({ sources: [] })),
}));
vi.mock("@/db", () => ({ getDatabase: vi.fn(async () => ({})) }));
vi.mock("@/lib/admin/http", async () => {
	const { ZodError } = await import("zod");
	return {
		ADMIN_RESPONSE_HEADERS: { "Cache-Control": "no-store" },
		adminErrorResponse: vi.fn(
			(error: unknown) =>
				new Response(JSON.stringify({ error: String(error) }), {
					status: error instanceof ZodError ? 400 : 500,
				}),
		),
		readAdminJson: vi.fn(async (request: NextRequest) => request.json()),
		readOptionalAdminJson: vi.fn(async (request: NextRequest) => {
			const text = await request.text();
			return text.trim() ? JSON.parse(text) : {};
		}),
		requireAdminSession: vi.fn(async () => null),
	};
});
vi.mock("@/lib/admin/native-item-service", () => ({
	publishItemDraftWithContext,
	unpublishNativeItemWithOutcome,
}));
vi.mock("@/lib/admin/source-writeback-service", () => ({
	resolveAdminSourceWritebackConflict,
	setAdminItemWritebackSources,
}));
vi.mock("@/lib/source-writeback/runtime", () => ({
	createSourceWritebackRuntime: vi.fn(() => ({
		credentialResolver: vi.fn(),
		registry: {},
	})),
}));

const base = "https://library.example.org/api/admin/items/ABCD2345";
const params = { params: Promise.resolve({ key: "ABCD2345" }) };
const post = (path: string, body?: unknown) =>
	new NextRequest(`${base}/${path}`, {
		body: body === undefined ? undefined : JSON.stringify(body),
		headers: { "content-type": "application/json" },
		method: path === "writeback/sources" ? "PUT" : "POST",
	});
const conflictStatus = {
	attempts: 0,
	canonicalRevision: 3,
	error: null,
	jobId: null,
	nextAttemptAt: null,
	processedAt: null,
	sourceKey: "zotero-a",
	state: "queued",
};

describe("admin writeback request bodies", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		publishItemDraftWithContext.mockResolvedValue({
			indexingRecords: [],
			item: { key: "ABCD2345" },
		});
		unpublishNativeItemWithOutcome.mockResolvedValue({
			changed: true,
			indexingRecords: [],
			item: { key: "ABCD2345" },
		});
		setAdminItemWritebackSources.mockResolvedValue({
			available: [],
			originSourceKey: null,
			selected: ["zotero-a"],
		});
	});

	it("passes the chosen sources to publish, and keeps the stored choice when the body is empty", async () => {
		const { POST } = await import("@/app/api/admin/items/[key]/publish/route");
		expect((await POST(post("publish", { sourceKeys: ["zotero-a", "zotero-b"] }), params)).status).toBe(200);
		expect(publishItemDraftWithContext).toHaveBeenLastCalledWith(
			{},
			"ABCD2345",
			expect.objectContaining({ sourceKeys: ["zotero-a", "zotero-b"] }),
		);

		expect((await POST(post("publish"), params)).status).toBe(200);
		expect(publishItemDraftWithContext).toHaveBeenLastCalledWith(
			{},
			"ABCD2345",
			expect.objectContaining({ sourceKeys: undefined }),
		);
	});

	it("rejects an unknown publish field", async () => {
		const { POST } = await import("@/app/api/admin/items/[key]/publish/route");
		const response = await POST(post("publish", { defaultWriteback: true }), params);
		expect(response.status).toBe(400);
		expect(publishItemDraftWithContext).not.toHaveBeenCalled();
	});

	it("passes the sources to remove from to unpublish", async () => {
		const { POST } = await import("@/app/api/admin/items/[key]/unpublish/route");
		expect((await POST(post("unpublish", { removeFromSourceKeys: ["zotero-a"] }), params)).status).toBe(200);
		expect(unpublishNativeItemWithOutcome).toHaveBeenLastCalledWith(
			{},
			"ABCD2345",
			{ removeFromSourceKeys: ["zotero-a"] },
		);
		expect((await POST(post("unpublish"), params)).status).toBe(200);
		expect(unpublishNativeItemWithOutcome).toHaveBeenLastCalledWith(
			{},
			"ABCD2345",
			{ removeFromSourceKeys: undefined },
		);
	});

	it("saves the source choice without publishing and returns the new targets", async () => {
		const { PUT } = await import("@/app/api/admin/items/[key]/writeback/sources/route");
		const response = await PUT(post("writeback/sources", { sourceKeys: ["zotero-a"] }), params);
		expect(response.status).toBe(200);
		expect(setAdminItemWritebackSources).toHaveBeenCalledWith({}, "ABCD2345", ["zotero-a"], { sources: [] });
		expect(await response.json()).toEqual({
			writeback: { available: [], originSourceKey: null, selected: ["zotero-a"] },
		});

		expect((await PUT(post("writeback/sources", {}), params)).status).toBe(400);
	});

	it("resolves a conflict with one of the two choices and needs the source key", async () => {
		resolveAdminSourceWritebackConflict.mockResolvedValue({
			indexingRecords: [{ key: "ABCD2345", revision: 4 }],
			status: conflictStatus,
		});
		const { POST } = await import("@/app/api/admin/items/[key]/writeback/resolve/route");
		const response = await POST(
			post("writeback/resolve?source=zotero-a", { choice: "send-local" }),
			params,
		);
		expect(response.status).toBe(200);
		expect(resolveAdminSourceWritebackConflict).toHaveBeenCalledWith(
			{},
			"ABCD2345",
			"zotero-a",
			"send-local",
			{ sources: [] },
			expect.objectContaining({ registry: {} }),
		);
		expect(await response.json()).toEqual({
			indexingReceipts: [{ entityKey: "ABCD2345", entityType: "item", revision: 4 }],
			status: conflictStatus,
		});

		expect((await POST(post("writeback/resolve", { choice: "load-remote" }), params)).status).toBe(400);
		expect((await POST(post("writeback/resolve?source=zotero-a", { choice: "overwrite" }), params)).status).toBe(400);
	});
});
