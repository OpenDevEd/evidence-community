import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
	ADMIN_SESSION_COOKIE,
	ADMIN_SESSION_TTL_MS,
	adminPasswordMatches,
	adminSessionCookieName,
	adminSessionCookieOptions,
	createAdminSessionToken,
	verifyAdminSessionToken,
} from "@/lib/admin/access";

const credentials = {
	password: "correct horse battery staple",
	secret: "12345678901234567890123456789012",
};

describe("admin access", () => {
	it("accepts only the configured password", () => {
		expect(
			adminPasswordMatches("correct horse battery staple", credentials),
		).toBe(true);
		expect(adminPasswordMatches("wrong password", credentials)).toBe(false);
	});

	it("accepts an unexpired signed session", () => {
		const now = Date.UTC(2026, 7, 13, 12);
		const token = createAdminSessionToken(credentials, now);

		expect(verifyAdminSessionToken(token, credentials, now + 1_000)).toBe(
			true,
		);
		expect(
			verifyAdminSessionToken(
				token,
				credentials,
				now + ADMIN_SESSION_TTL_MS,
			),
		).toBe(false);
	});

	it("rejects tampered sessions and changed credentials", () => {
		const now = Date.UTC(2026, 7, 13, 12);
		const token = createAdminSessionToken(credentials, now);

		expect(verifyAdminSessionToken(`${token}x`, credentials, now)).toBe(
			false,
		);
		expect(
			verifyAdminSessionToken(
				token,
				{ ...credentials, password: "a new password" },
				now,
			),
		).toBe(false);
		expect(
			verifyAdminSessionToken(
				token,
				{ ...credentials, secret: "abcdefghijklmnopqrstuvwxyz123456" },
				now,
			),
		).toBe(false);
	});

	it("uses a host-only secure private cookie", () => {
		expect(ADMIN_SESSION_COOKIE).toBe("__Host-evidence_library_admin");
		expect(adminSessionCookieName("production")).toBe(ADMIN_SESSION_COOKIE);
		expect(adminSessionCookieName("development")).toBe(
			"evidence_library_admin",
		);
		expect(adminSessionCookieOptions("production")).toEqual({
			httpOnly: true,
			maxAge: ADMIN_SESSION_TTL_MS / 1_000,
			path: "/",
			sameSite: "strict",
			secure: true,
		});
		expect(adminSessionCookieOptions("production")).not.toHaveProperty(
			"domain",
		);
		expect(adminSessionCookieOptions("development").secure).toBe(false);
	});
});
