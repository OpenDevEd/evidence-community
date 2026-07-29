import { afterEach, describe, expect, it } from "vitest";

import { isAdminBypassEnabled } from "@/lib/admin/access";

const originalBypass = process.env.ADMIN_AUTH_BYPASS;

afterEach(() => {
	if (originalBypass === undefined) {
		delete process.env.ADMIN_AUTH_BYPASS;
	} else {
		process.env.ADMIN_AUTH_BYPASS = originalBypass;
	}
});

describe("temporary admin bypass", () => {
	it("is enabled only by the exact true value", () => {
		for (const value of ["1", "TRUE", "yes", "false", ""]) {
			process.env.ADMIN_AUTH_BYPASS = value;
			expect(isAdminBypassEnabled()).toBe(false);
		}

		process.env.ADMIN_AUTH_BYPASS = "true";
		expect(isAdminBypassEnabled()).toBe(true);
	});
});
