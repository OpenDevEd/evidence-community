import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
	ADMIN_CONTENT_PERMISSION,
	ADMIN_LIBRARY_PERMISSION,
	ADMIN_SESSION_COOKIE,
	ADMIN_SESSION_TTL_MS,
	adminSessionCookieName,
	adminSessionCookieOptions,
	adminRoleHasPermission,
	createAdminSessionToken,
	verifyAdminSessionToken,
} from "@/lib/admin/access";

const signingConfig = {
	libraryId: "kh7ejpj5mm3s2pvwmz9n08b2v98d3kn5",
	secret: "12345678901234567890123456789012",
};
const redeemedIdentity = {
	clerkOrganizationId: "org_2abc",
	clerkUserId: "user_2abc",
	consumedAt: Date.UTC(2026, 7, 24, 11, 59),
	libraryId: signingConfig.libraryId,
	role: "editor" as const,
};

describe("admin access", () => {
	it("allows both roles to manage content and only Owners to manage the library", () => {
		expect(adminRoleHasPermission("owner", ADMIN_CONTENT_PERMISSION)).toBe(
			true,
		);
		expect(adminRoleHasPermission("editor", ADMIN_CONTENT_PERMISSION)).toBe(
			true,
		);
		expect(adminRoleHasPermission("owner", ADMIN_LIBRARY_PERMISSION)).toBe(
			true,
		);
		expect(adminRoleHasPermission("editor", ADMIN_LIBRARY_PERMISSION)).toBe(
			false,
		);
	});

	it("returns the identity and role from an unexpired signed session", () => {
		const now = Date.UTC(2026, 7, 24, 12);
		const token = createAdminSessionToken(
			redeemedIdentity,
			signingConfig,
			now,
		);

		expect(
			verifyAdminSessionToken(token, signingConfig, now + 1_000),
		).toEqual({
			...redeemedIdentity,
			expiresAt: now + ADMIN_SESSION_TTL_MS,
		});
		expect(
			verifyAdminSessionToken(
				token,
				signingConfig,
				now + ADMIN_SESSION_TTL_MS,
			),
		).toBeNull();
	});

	it("rejects tampered sessions and sessions for another library", () => {
		const now = Date.UTC(2026, 7, 24, 12);
		const token = createAdminSessionToken(
			redeemedIdentity,
			signingConfig,
			now,
		);

		expect(
			verifyAdminSessionToken(`${token}x`, signingConfig, now),
		).toBeNull();
		expect(
			verifyAdminSessionToken(
				token,
				{ ...signingConfig, libraryId: "another-library" },
				now,
			),
		).toBeNull();
		expect(
			verifyAdminSessionToken(
				token,
				{
					...signingConfig,
					secret: "abcdefghijklmnopqrstuvwxyz123456",
				},
				now,
			),
		).toBeNull();
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
			sameSite: "lax",
			secure: true,
		});
		expect(adminSessionCookieOptions("production")).not.toHaveProperty(
			"domain",
		);
		expect(adminSessionCookieOptions("development").secure).toBe(false);
	});
});
