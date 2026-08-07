import { describe, expect, it, vi } from "vitest";

import {
	SourceWritebackAdapterNotFoundError,
	SourceWritebackAdapterRegistrationError,
	SourceWritebackAdapterRegistry,
} from "@/lib/source-writeback/adapter";
import { sourceWritebackIdempotencyKey } from "@/lib/source-writeback/queue";

describe("SourceWritebackAdapterRegistry", () => {
	const zotero = {
		provider: "zotero" as const,
		write: vi.fn(),
	};

	it("dispatches registered remote providers", () => {
		const registry = new SourceWritebackAdapterRegistry([zotero]);
		expect(registry.get("zotero")).toBe(zotero);
		expect(registry.has("zotero")).toBe(true);
		expect(registry.has("native")).toBe(false);
	});

	it("rejects duplicate and missing adapters", () => {
		expect(
			() => new SourceWritebackAdapterRegistry([zotero, zotero]),
		).toThrow(SourceWritebackAdapterRegistrationError);
		expect(() =>
			new SourceWritebackAdapterRegistry().get("zotero"),
		).toThrow(SourceWritebackAdapterNotFoundError);
		expect(() =>
			new SourceWritebackAdapterRegistry().get("native"),
		).toThrow(SourceWritebackAdapterNotFoundError);
	});
});

describe("sourceWritebackIdempotencyKey", () => {
	it("is stable per source, item, revision, and operation", () => {
		const input = {
			canonicalRevision: 42,
			entity: "item" as const,
			entityKey: "ABCD2345",
			operation: "upsert" as const,
			sourceConnectionKey: "zotero-test",
		};
		expect(sourceWritebackIdempotencyKey(input)).toBe(
			"source-writeback:zotero-test:item:ABCD2345:42:upsert",
		);
		expect(sourceWritebackIdempotencyKey(input)).toBe(
			sourceWritebackIdempotencyKey({ ...input }),
		);
		expect(
			sourceWritebackIdempotencyKey({ ...input, canonicalRevision: 43 }),
		).not.toBe(sourceWritebackIdempotencyKey(input));
	});
});
