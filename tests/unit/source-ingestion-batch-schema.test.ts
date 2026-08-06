import { describe, expect, it } from "vitest";

import {
	MAX_SOURCE_RECORD_BYTES,
	sourceIngestionBatchSchema,
	type SourceItemUpsert,
} from "@/lib/source-ingestion/batch-schema";
import { sourceItemFingerprint } from "@/lib/source-ingestion/fingerprint";

function batch() {
	return {
		sourceConnectionKey: "zotero-example",
		expectedCursor: {},
		nextCursor: { version: 1 },
		mappingProfileVersion: "zotero-v1",
		fetchedAt: new Date("2026-07-29T12:00:00.000Z"),
		collections: [],
		items: [
			{
				operation: "upsert",
				sourceRecordKey: "ITEM0001",
				remoteVersion: "1",
				raw: { key: "ITEM0001", version: 1 },
				metadata: {
					itemType: "Attachment",
					title: "Example PDF",
					tags: ["publishPDF"],
				},
				parentSourceRecordKey: "PARENT01",
				collections: [
					{ sourceRecordKey: "COLL0001" },
					{
						sourceConnectionKey: "mendeley-shared",
						sourceRecordKey: "SHARED01",
					},
				],
				aliases: [{ key: "zotero:ITEM0001", kind: "provider-uri" }],
				file: {
					url: "https://storage.example.org/file.pdf",
					contentType: "application/pdf",
					filename: "file.pdf",
					coverUrl: "https://storage.example.org/cover.png",
					coverWidth: 1200,
					coverHeight: 1600,
				},
			},
		],
	};
}

describe("sourceIngestionBatchSchema", () => {
	it("accepts provider-neutral records and cross-source memberships", () => {
		const parsed = sourceIngestionBatchSchema.parse(batch());
		expect(parsed.items).toHaveLength(1);
		expect(parsed.items[0]).toMatchObject({
			operation: "upsert",
			sourceRecordKey: "ITEM0001",
		});
	});

	it("rejects duplicate source record keys", () => {
		const input = batch();
		input.items.push({ ...input.items[0]! });
		const parsed = sourceIngestionBatchSchema.safeParse(input);
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues[0]?.message).toContain(
				"Duplicate items sourceRecordKey",
			);
		}
	});

	it("rejects delete and upsert operations for the same item", () => {
		const original = batch();
		const parsed = sourceIngestionBatchSchema.safeParse({
			...original,
			items: [
				...original.items,
				{
					operation: "delete",
					sourceRecordKey: original.items[0]!.sourceRecordKey,
				},
			],
		});
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues[0]?.message).toContain(
				"Duplicate items sourceRecordKey",
			);
		}
	});

	it("requires complete cover metadata", () => {
		const input = batch();
		const item = input.items[0]!;
		item.file = {
			...item.file!,
			coverHeight: undefined as never,
		};
		const parsed = sourceIngestionBatchSchema.safeParse(input);
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(
				parsed.error.issues.some((issue) =>
					issue.message.includes(
						"coverUrl, coverWidth, and coverHeight",
					),
				),
			).toBe(true);
		}
	});

	it("rejects non-JSON source snapshots", () => {
		const input = batch();
		input.items[0]!.raw = {
			invalid: BigInt(1),
		} as never;
		expect(sourceIngestionBatchSchema.safeParse(input).success).toBe(false);
	});

	it("rejects duplicate collection identities after applying the connection default", () => {
		const input = batch();
		input.items[0]!.collections = [
			{ sourceRecordKey: "COLL0001" },
			{
				sourceConnectionKey: input.sourceConnectionKey,
				sourceRecordKey: "COLL0001",
			},
		];
		const parsed = sourceIngestionBatchSchema.safeParse(input);
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(
				parsed.error.issues.some(
					(issue) =>
						issue.message === "Duplicate collection reference",
				),
			).toBe(true);
		}
	});

	it("bounds individual provider records", () => {
		const input = batch();
		input.items[0]!.raw = {
			oversized: "x".repeat(MAX_SOURCE_RECORD_BYTES),
		} as never;
		const parsed = sourceIngestionBatchSchema.safeParse(input);
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(
				parsed.error.issues.some((issue) =>
					issue.message.includes("Source record exceeds"),
				),
			).toBe(true);
		}
	});
});

describe("sourceItemFingerprint", () => {
	it("tracks canonical sidecars while ignoring version and JSON key order", () => {
		const parsed = sourceIngestionBatchSchema.parse(batch());
		const record = parsed.items[0] as SourceItemUpsert;
		const baseline = sourceItemFingerprint(record);
		const variants: SourceItemUpsert[] = [
			{ ...record, aliases: [] },
			{ ...record, collections: [] },
			{ ...record, file: { ...record.file!, md5: "changed" } },
			{ ...record, metadata: { ...record.metadata, title: "Changed" } },
			{ ...record, parentSourceRecordKey: "PARENT02" },
			{ ...record, raw: { ...record.raw, version: 2 } },
			{
				...record,
				sourceDates: {
					addedAt: new Date("2026-07-28T00:00:00.000Z"),
					modifiedAt: null,
				},
			},
		];

		for (const variant of variants) {
			expect(sourceItemFingerprint(variant)).not.toBe(baseline);
		}
		expect(sourceItemFingerprint({ ...record, remoteVersion: "2" })).toBe(
			baseline,
		);
		expect(
			sourceItemFingerprint({
				...record,
				raw: { version: 1, key: "ITEM0001" },
			}),
		).toBe(baseline);
	});
});
