import { describe, expect, it } from "vitest";
import { recordReferrer } from "@/constants/misc";

describe("where a record link says it was opened from", () => {
	it("names a profile, the one list that isn't the default", () => {
		expect(recordReferrer("/profile/reader-1", null)).toBe("/profile/reader-1");
	});

	it("keeps a profile carried from the record it is opened beside", () => {
		expect(recordReferrer("/lib/ABCD2345", "/profile/reader-1")).toBe("/profile/reader-1");
	});

	it("names no other page, so a record keeps one address", () => {
		for (const path of ["/", "/lib", "/lib/ABCD2345", "/browse/1988", "/digests/edition-1"]) expect(recordReferrer(path, null)).toBeNull();
		expect(recordReferrer("/lib/ABCD2345", "/browse/1988")).toBeNull();
	});
});
