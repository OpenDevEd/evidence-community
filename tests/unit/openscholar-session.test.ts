import { describe, expect, it } from "vitest";

import { openScholarSessionCookie } from "@/lib/readers/openscholar";
import { followStep, TRIES_MAX, triesFor } from "@/lib/readers/session-follow";

describe("the cookie that says who is signed in to Openscholar", () => {
	// Clerk names it after its publishable key. These are the names it wrote in browsers on openscholar.ai, read there on 2026-11-11.
	it("is named as Clerk names it for a production instance", () => {
		expect(openScholarSessionCookie("https://clerk.openscholar.ai")).toBe("__client_uat_oNairmV_");
	});

	it("is not followed for a development instance, whose sign-in session lives on its own site", () => {
		expect(openScholarSessionCookie("https://subtle-rhino-55.clerk.accounts.dev")).toBeNull();
	});
});

describe("following the Openscholar session", () => {
	const step = (state: Partial<Parameters<typeof followStep>[0]>) => followStep({ stamp: null, seen: null, signedIn: false, tries: 0, asked: false, ...state });

	it("does nothing where the cookie can't be read, as on a community's own domain", () => {
		expect(step({ stamp: null, seen: "1793000000", signedIn: true })).toBe("none");
		expect(step({ stamp: null })).toBe("none");
	});

	it("does nothing while a signed-in reader's session is the one already followed", () => {
		expect(step({ stamp: "1793000000", seen: "1793000000", signedIn: true })).toBe("none");
	});

	it("signs in when someone has signed in to Openscholar since", () => {
		expect(step({ stamp: "1793000000" })).toBe("sign-in");
		expect(step({ stamp: "1793000000", seen: "0" })).toBe("sign-in");
		// Whoever signed out here before: signing in to Openscholar again is asking to be signed in.
		expect(step({ stamp: "1793000000", seen: "0", asked: true })).toBe("sign-in");
	});

	it("signs in again when Openscholar's session changed under a signed-in reader, who may be another account now", () => {
		expect(step({ stamp: "1793000500", seen: "1793000000", signedIn: true })).toBe("sign-in");
	});

	it("signs in again a reader whose session here was lost, while Openscholar's is the one followed", () => {
		expect(step({ stamp: "1793000000", seen: "1793000000" })).toBe("sign-in");
	});

	it("leaves signed out a reader who signed out here, while Openscholar's session stays as it was", () => {
		expect(step({ stamp: "1793000000", seen: "1793000000", asked: true })).toBe("none");
	});

	it("gives up on a value its sign-in keeps failing for, and tries the next one", () => {
		expect(step({ stamp: "1793000000", tries: TRIES_MAX - 1 })).toBe("sign-in");
		expect(step({ stamp: "1793000000", tries: TRIES_MAX })).toBe("none");
		expect(step({ stamp: "1793000000", seen: "1793000000", tries: TRIES_MAX })).toBe("none");
		expect(triesFor("1793000500", `1793000000:${TRIES_MAX}`)).toBe(0);
		expect(triesFor("1793000000", "1793000000:2")).toBe(2);
		expect(triesFor("1793000000", null)).toBe(0);
	});

	it("signs out when Openscholar has signed out, once", () => {
		expect(step({ stamp: "0", seen: "1793000000", signedIn: true })).toBe("sign-out");
		expect(step({ stamp: "0", seen: "0", signedIn: true })).toBe("none");
	});

	it("has nothing to do when Openscholar signed out and nobody is signed in here", () => {
		expect(step({ stamp: "0", seen: "1793000000" })).toBe("none");
	});
});
