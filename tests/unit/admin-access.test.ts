import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/readers/session", () => import("../helpers/reader-session"));

import {
	ADMIN_CONTENT_PERMISSION,
	ADMIN_LIBRARY_PERMISSION,
	ADMIN_PUBLISH_PERMISSION,
	adminRoleHasPermission,
	authorizeAdminRequest,
} from "@/lib/admin/access";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { signedInHeaders } from "../helpers/reader-session";

const config = {
	authentication: {
		openScholar: {
			convexSiteUrl: "https://access.example.test",
			libraryId: "kh7ejpj5mm3s2pvwmz9n08b2v98d3kn5",
			machineCredential: "test-machine-credential",
		},
	},
} as unknown as LibraryServerConfig;

let user = 0;
/** Role answers are kept for a minute per person, so each case signs in someone new. */
function nextUser() {
	user += 1;
	return `user_access_${user}`;
}

afterEach(() => vi.unstubAllGlobals());

describe("admin roles", () => {
	it("allows both roles to manage content and only Owners to manage the library", () => {
		expect(adminRoleHasPermission("owner", ADMIN_CONTENT_PERMISSION)).toBe(true);
		expect(adminRoleHasPermission("editor", ADMIN_CONTENT_PERMISSION)).toBe(true);
		expect(adminRoleHasPermission("owner", ADMIN_LIBRARY_PERMISSION)).toBe(true);
		expect(adminRoleHasPermission("editor", ADMIN_LIBRARY_PERMISSION)).toBe(false);
	});

	it("lets Creators edit drafts but reserves publishing for Editors and Owners", () => {
		expect(adminRoleHasPermission("creator", ADMIN_CONTENT_PERMISSION)).toBe(true);
		expect(adminRoleHasPermission("creator", ADMIN_PUBLISH_PERMISSION)).toBe(false);
		expect(adminRoleHasPermission("creator", ADMIN_LIBRARY_PERMISSION)).toBe(false);
		expect(adminRoleHasPermission("editor", ADMIN_PUBLISH_PERMISSION)).toBe(true);
		expect(adminRoleHasPermission("owner", ADMIN_PUBLISH_PERMISSION)).toBe(true);
	});
});

describe("admin access on the shared session", () => {
	it("asks OpenScholar for the signed-in person's role by Clerk user ID", async () => {
		const clerkUserId = nextUser();
		const fetcher = vi.fn(async () => Response.json({ role: "creator" }));
		vi.stubGlobal("fetch", fetcher);
		expect(await authorizeAdminRequest(signedInHeaders(clerkUserId), ADMIN_PUBLISH_PERMISSION, config)).toEqual({
			status: "forbidden",
			session: { clerkUserId, role: "creator", name: "Test reader", image: null },
		});
		const [url, request] = fetcher.mock.calls[0] as unknown as [URL, RequestInit & { headers: Record<string, string> }];
		expect(String(url)).toBe("https://access.example.test/api/v1/evidence-libraries/admin-session/check");
		expect(JSON.parse(String(request.body))).toEqual({ libraryId: "kh7ejpj5mm3s2pvwmz9n08b2v98d3kn5", clerkUserId });
		expect(request.headers.Authorization).toBe("Bearer test-machine-credential");
		expect(request.cache).toBe("no-store");
	});

	it("answers no access with the organisation to ask when OpenScholar gives no role", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "access_revoked", organisationName: "OpenDevEd" }, { status: 403 })));
		expect(await authorizeAdminRequest(signedInHeaders(nextUser()), ADMIN_CONTENT_PERMISSION, config)).toEqual({
			status: "no_access",
			organisationName: "OpenDevEd",
		});
	});

	it("reuses OpenScholar's answer for a minute instead of asking on every request", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		try {
			const clerkUserId = nextUser();
			const fetcher = vi.fn(async () => Response.json({ role: "owner" }));
			vi.stubGlobal("fetch", fetcher);
			await authorizeAdminRequest(signedInHeaders(clerkUserId), ADMIN_CONTENT_PERMISSION, config);
			await authorizeAdminRequest(signedInHeaders(clerkUserId), ADMIN_LIBRARY_PERMISSION, config);
			expect(fetcher).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(61_000);
			await authorizeAdminRequest(signedInHeaders(clerkUserId), ADMIN_CONTENT_PERMISSION, config);
			expect(fetcher).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("asks no one when nobody is signed in", async () => {
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		expect(await authorizeAdminRequest(signedInHeaders(), ADMIN_CONTENT_PERMISSION, config)).toEqual({ status: "unauthenticated" });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("reports an OpenScholar outage as unavailable rather than as no access", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
		expect(await authorizeAdminRequest(signedInHeaders(nextUser()), ADMIN_CONTENT_PERMISSION, config)).toEqual({ status: "unavailable" });
	});
});
