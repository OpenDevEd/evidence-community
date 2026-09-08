import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
	ADMIN_CONTENT_PERMISSION,
	ADMIN_PUBLISH_PERMISSION,
	authorizeAdminSession,
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

  afterEach(() => vi.unstubAllGlobals());

  it("lets Creators edit drafts but reserves publishing for Editors and Owners", () => {
    expect(adminRoleHasPermission("creator", ADMIN_CONTENT_PERMISSION)).toBe(true);
    expect(adminRoleHasPermission("creator", ADMIN_PUBLISH_PERMISSION)).toBe(false);
    expect(adminRoleHasPermission("creator", ADMIN_LIBRARY_PERMISSION)).toBe(false);
    expect(adminRoleHasPermission("editor", ADMIN_PUBLISH_PERMISSION)).toBe(true);
    expect(adminRoleHasPermission("owner", ADMIN_PUBLISH_PERMISSION)).toBe(true);
  });

  it("uses the current role and rejects a revoked session before cookie expiry", async () => {
    const config = { ...signingConfig, convexSiteUrl: "https://access.example.test", loginPageUrl: "https://app.example.test/login", machineCredential: "test-machine-credential" };
    const token = createAdminSessionToken({ ...redeemedIdentity, role: "owner" }, config);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ role: "creator" }))
      .mockResolvedValueOnce(Response.json({ error: "access_revoked" }, { status: 403 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await authorizeAdminSession(token, ADMIN_PUBLISH_PERMISSION, config)).toEqual({
      status: "forbidden", session: expect.objectContaining({ role: "creator" }),
    });
    expect(await authorizeAdminSession(token, ADMIN_CONTENT_PERMISSION, config)).toEqual({ status: "unauthenticated" });
    const [url, request] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://access.example.test/api/v1/evidence-libraries/admin-session/check");
    expect(JSON.parse(request.body)).toEqual({ libraryId: config.libraryId, clerkUserId: redeemedIdentity.clerkUserId });
    expect(request.headers.Authorization).toBe("Bearer test-machine-credential");
    expect(request.cache).toBe("no-store");
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
