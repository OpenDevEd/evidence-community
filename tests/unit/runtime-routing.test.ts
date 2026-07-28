import { describe, expect, it } from "vitest";

import {
	getCanonicalLibraryRedirect,
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
		expect(isLoginProfilePath("/en-GB/profiled/user-one")).toBe(
			false,
		);
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
				headers.set(
					"x-forwarded-proto",
					forwardedProtocol,
				);
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

		expect(redirect?.toString()).toBe(
			"https://library.example.org/lib",
		);
	});
});
