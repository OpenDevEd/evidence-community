import { describe, expect, it } from "vitest";

import {
	describeAdminWritebackError,
	resolveAdminSourceWritebackState,
} from "@/lib/admin/source-writeback-service";

const now = new Date("2026-08-07T12:00:00.000Z");
const baseJob = {
	attempts: 0,
	canonicalRevision: 2,
	createdAt: now,
	deadLetteredAt: null,
	id: 1,
	lastError: null,
	leaseExpiresAt: null,
	leaseOwner: null,
	nextAttemptAt: now,
	processedAt: null,
};

describe("admin source writeback state", () => {
	it("distinguishes queued, sending, retrying, and failed jobs", () => {
		expect(resolveAdminSourceWritebackState(baseJob, null, now)).toBe("queued");
		expect(
			resolveAdminSourceWritebackState(
				{
					...baseJob,
					leaseOwner: "worker",
					leaseExpiresAt: new Date(now.getTime() + 1_000),
				},
				null,
				now,
			),
		).toBe("sending");
		expect(
			resolveAdminSourceWritebackState(
				{ ...baseJob, attempts: 2, lastError: "temporary" },
				null,
				now,
			),
		).toBe("retrying");
		expect(
			resolveAdminSourceWritebackState(
				{ ...baseJob, deadLetteredAt: now },
				null,
				now,
			),
		).toBe("failed");
	});

	it("uses link acknowledgement as the synced ground truth", () => {
		expect(
			resolveAdminSourceWritebackState(
				{ ...baseJob, processedAt: now },
				{ dirtyFields: [], lastAcknowledgedRemoteVersion: "42" },
				now,
			),
		).toBe("synced");
		expect(
			resolveAdminSourceWritebackState(
				null,
				{ dirtyFields: ["title"], lastAcknowledgedRemoteVersion: "41" },
				now,
			),
		).toBe("idle");
	});
});

describe("describeAdminWritebackError", () => {
	it("explains a key collision in plain words", () => {
		expect(
			describeAdminWritebackError(
				"ZoteroWritebackKeyCollisionError: Zotero item key ABCD2345 already exists with different data",
				{ itemKey: "ABCD2345", sourceLabel: "Zotero · 6632364" },
			),
		).toBe(
			"Zotero · 6632364 already has a different item with key ABCD2345. Delete that item in Zotero · 6632364, then retry.",
		);
	});

	it("passes other errors through and keeps null", () => {
		expect(
			describeAdminWritebackError("ZoteroApiError: 503 busy", {
				itemKey: "ABCD2345",
				sourceLabel: "Zotero · 6632364",
			}),
		).toBe("ZoteroApiError: 503 busy");
		expect(
			describeAdminWritebackError(null, {
				itemKey: "ABCD2345",
				sourceLabel: "Zotero · 6632364",
			}),
		).toBeNull();
	});
});
