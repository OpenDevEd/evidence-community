import { describe, expect, it } from "vitest";

import {
	buildAdminLoginPageUrl,
	getCanonicalLibraryRedirect,
	getExternalRequestOrigin,
	getUnlocalizedPathname,
	getValidatedAdminReturnPath,
	isAdminPagePath,
	isLoginProfilePath,
} from "@/lib/runtime-routing";

describe("runtime route enforcement", () => {
	it.each([
		"/profile",
		"/profile/user-one",
		"/en-GB/profile",
		"/en-GB/profile/user-one",
	])("recognizes the login-only profile route %s", (pathname) => {
		expect(isLoginProfilePath(pathname)).toBe(true);
	});

	it("does not treat similarly named routes as profiles", () => {
		expect(isLoginProfilePath("/profiled")).toBe(false);
		expect(isLoginProfilePath("/en-GB/profiled/user-one")).toBe(false);
	});

	it("removes a supported locale prefix", () => {
		expect(getUnlocalizedPathname("/en-GB/profile/user-one")).toBe(
			"/profile/user-one",
		);
	});

	it("canonicalizes non-loopback aliases while preserving path and query", () => {
		const redirect = getCanonicalLibraryRedirect(
			new URL("http://internal:3000/lib?search=proof"),
			new Headers({
				host: "internal:3000",
				"x-forwarded-host": "alias.example.org",
			}),
			"https://library.example.org",
		);

		expect(redirect?.toString()).toBe(
			"https://library.example.org/lib?search=proof",
		);
	});

	it("leaves the canonical and local verification hosts untouched", () => {
		expect(
			getCanonicalLibraryRedirect(
				new URL("https://library.example.org/lib"),
				new Headers({
					host: "internal:3000",
					"x-forwarded-host": "library.example.org",
					"x-forwarded-proto": "https",
				}),
				"https://library.example.org",
			),
		).toBeNull();
		expect(
			getCanonicalLibraryRedirect(
				new URL("http://127.0.0.1:3112/lib"),
				new Headers({ host: "127.0.0.1:3112" }),
				"https://library.example.org",
			),
		).toBeNull();
	});

	it.each([undefined, "http", "https"])(
		"leaves protocol enforcement to a proxy reporting %s",
		(forwardedProtocol) => {
			const headers = new Headers({
				host: "internal:3000",
				"x-forwarded-host": "library.example.org",
			});
			if (forwardedProtocol) {
				headers.set("x-forwarded-proto", forwardedProtocol);
			}

			expect(
				getCanonicalLibraryRedirect(
					new URL("http://internal:3000/lib"),
					headers,
					"https://library.example.org",
				),
			).toBeNull();
		},
	);

	it("upgrades a direct canonical HTTP request", () => {
		const redirect = getCanonicalLibraryRedirect(
			new URL("http://library.example.org/lib"),
			new Headers({ host: "library.example.org" }),
			"https://library.example.org",
		);

		expect(redirect?.toString()).toBe("https://library.example.org/lib");
	});

	it("rebuilds the public origin reported by the trusted proxy", () => {
		expect(
			getExternalRequestOrigin(
				new URL("http://web:3000/api/admin/session"),
				new Headers({
					host: "web:3000",
					"x-forwarded-host": "library.example.org",
					"x-forwarded-proto": "https",
				}),
			),
		).toBe("https://library.example.org");
	});
});

describe("admin page paths", () => {
	it.each(["/admin", "/admin/items", "/en-GB/admin", "/fr/admin/items"])(
		"recognizes the admin page %s",
		(pathname) => {
			expect(isAdminPagePath(pathname)).toBe(true);
		},
	);

	it.each([
		"/lib",
		"/adminish",
		"/api/admin/items",
		"/en-GB/api/admin/items",
		"/",
	])("leaves %s alone", (pathname) => {
		expect(isAdminPagePath(pathname)).toBe(false);
	});
});

describe("admin return path", () => {
	it.each([
		["/admin", "/admin"],
		["/admin/items?scope=drafts", "/admin/items?scope=drafts"],
		["/en-GB/admin/items/ABCD1234", "/en-GB/admin/items/ABCD1234"],
		["/admin?tab=records#top", "/admin?tab=records"],
	])("keeps the admin path %s", (value, expected) => {
		expect(getValidatedAdminReturnPath(value)).toBe(expected);
	});

	it.each([
		"https://evil.example.org/admin",
		"//evil.example.org/admin",
		"/\\evil.example.org/admin",
		"http://library.example.org/admin",
		"/lib",
		"/adminish",
		"/en-GB/lib",
		"admin",
		"",
	])("falls back to /admin for %s", (value) => {
		expect(getValidatedAdminReturnPath(value)).toBe("/admin");
	});

	it("falls back to /admin when nothing was sent", () => {
		expect(getValidatedAdminReturnPath(null)).toBe("/admin");
		expect(getValidatedAdminReturnPath(undefined)).toBe("/admin");
	});

	it("sends the browser back to OpenScholar with the return path", () => {
		expect(
			buildAdminLoginPageUrl(
				"https://openscholar.example.org/evidence-libraries/amber",
				"/admin/items?scope=drafts",
			),
		).toBe(
			"https://openscholar.example.org/evidence-libraries/amber?return=%2Fadmin%2Fitems%3Fscope%3Ddrafts",
		);
	});

	it("marks a failed code exchange for OpenScholar", () => {
		expect(
			buildAdminLoginPageUrl(
				"https://openscholar.example.org/evidence-libraries/amber",
				"/admin",
				"invalid_code",
			),
		).toBe(
			"https://openscholar.example.org/evidence-libraries/amber?error=invalid_code&return=%2Fadmin",
		);
	});
});
