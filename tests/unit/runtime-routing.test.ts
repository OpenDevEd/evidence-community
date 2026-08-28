import { describe, expect, it } from "vitest";

import {
	getCanonicalLibraryRedirect,
	getExternalRequestOrigin,
	getRedirectLookupPath,
	getUnlocalizedPathname,
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

describe("unknown path lookup", () => {
	it.each([
		"/404",
		"/admin",
		"/citation",
		"/contact",
		"/cookie-policy",
		"/gapmaps",
		"/lib",
		"/map",
		"/newlib",
		"/privacy",
		"/profile",
		"/statistics",
		"/takedown",
	])("treats the built-in page %s as a known route", (pathname) => {
		expect(getRedirectLookupPath(pathname, false)).toBeNull();
		expect(getRedirectLookupPath(`/en-GB${pathname}`, false)).toBeNull();
	});

	it("keeps the terms page for itself when the owner wrote terms", () => {
		expect(getRedirectLookupPath("/terms", true)).toBeNull();
		expect(getRedirectLookupPath("/en-GB/terms", true)).toBeNull();
	});

	it("looks up /terms when the owner wrote no terms", () => {
		expect(getRedirectLookupPath("/terms", false)).toBe("terms");
		expect(getRedirectLookupPath("/en-GB/terms", false)).toBe("terms");
	});

	it("always looks up an address below /terms", () => {
		expect(getRedirectLookupPath("/terms/archive", true)).toBe(
			"terms/archive",
		);
		expect(getRedirectLookupPath("/en-GB/terms/archive", true)).toBe(
			"terms/archive",
		);
		expect(getRedirectLookupPath("/terms/archive", false)).toBe(
			"terms/archive",
		);
	});

	it("looks up a path the library does not serve", () => {
		expect(getRedirectLookupPath("/old-report/2024", true)).toBe(
			"old-report/2024",
		);
		expect(getRedirectLookupPath("/en-GB/old-report/2024", true)).toBe(
			"old-report/2024",
		);
	});

	it("has nothing to look up at the site root", () => {
		expect(getRedirectLookupPath("/", true)).toBeNull();
		expect(getRedirectLookupPath("/en-GB", true)).toBeNull();
	});
});
