import { describe, expect, it } from "vitest";

import { decideRemoteVersionCheck } from "@/lib/source-writeback/consumer";

describe("decideRemoteVersionCheck", () => {
	it("resumes when the source still has the version we last acknowledged", () => {
		expect(
			decideRemoteVersionCheck({
				lastAcknowledgedRemoteVersion: "42",
				remoteVersion: "42",
			}),
		).toEqual({ outcome: "proceed" });
	});

	it("marks a conflict when the source moved on", () => {
		expect(
			decideRemoteVersionCheck({
				lastAcknowledgedRemoteVersion: "42",
				remoteVersion: "57",
			}),
		).toEqual({ conflictRemoteVersion: "57", outcome: "conflict" });
	});

	it("proceeds when the source has no copy yet or the copy is gone", () => {
		expect(
			decideRemoteVersionCheck({
				lastAcknowledgedRemoteVersion: null,
				remoteVersion: null,
			}),
		).toEqual({ outcome: "proceed" });
		expect(
			decideRemoteVersionCheck({
				lastAcknowledgedRemoteVersion: "42",
				remoteVersion: null,
			}),
		).toEqual({ outcome: "proceed" });
	});

	it("treats a never-acknowledged link with a remote copy as a conflict", () => {
		expect(
			decideRemoteVersionCheck({
				lastAcknowledgedRemoteVersion: null,
				remoteVersion: "3",
			}),
		).toEqual({ conflictRemoteVersion: "3", outcome: "conflict" });
	});
});
