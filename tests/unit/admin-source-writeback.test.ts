import { describe, expect, it } from "vitest";

import { resolveAdminSourceWritebackState } from "@/lib/admin/source-writeback-service";

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
