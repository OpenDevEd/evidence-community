import type { BrowserContext, Page } from "@playwright/test";

import { cookieHeader, mintReaderSessionCookies } from "../../tools/readerTestSession";

/** The Clerk users the fake OpenScholar gives each role in the acceptance libraries. */
export const ACCEPTANCE_ADMINS = {
	editor: "user_acceptance_admin",
	creator: "user_acceptance_creator",
	owner: "user_acceptance_owner",
} as const;

function requiredEnvironment(name: string) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required to sign in during browser tests`);
	return value;
}

/**
 * Signs the browser in as this OpenScholar account with a session the
 * library's own Better Auth made. Clerk is not involved: the redirect to
 * OpenScholar is checked on its own.
 */
function mintSession(clerkUserId: string, name?: string) {
	return mintReaderSessionCookies(
		{
			databaseUrl: requiredEnvironment("EVIDENCE_LIBRARY_TEST_DATABASE_URL"),
			secret: requiredEnvironment("EVIDENCE_LIBRARY_TEST_AUTH_SECRET"),
			libraryBaseUrl: requiredEnvironment("EVIDENCE_LIBRARY_TEST_LIBRARY_BASE_URL"),
		},
		clerkUserId,
		{ name, cookieDomain: new URL(requiredEnvironment("PLAYWRIGHT_BASE_URL")).hostname },
	);
}

export async function signInAs(context: BrowserContext, clerkUserId: string, name?: string) {
	const { readerId, cookies } = await mintSession(clerkUserId, name);
	await context.addCookies(cookies.map((cookie) => ({ ...cookie, sameSite: cookie.sameSite ?? "Lax" })));
	return readerId;
}

/**
 * Browser suites reach the library through a test address, while Better Auth
 * accepts sign-in and sign-out only from the library's configured one, as a
 * browser on it would send. A page cannot change its Origin header, so these
 * requests go through Playwright with the library's origin instead.
 */
export async function sendAuthRequestsFromLibraryOrigin(page: Page) {
	const origin = new URL(requiredEnvironment("EVIDENCE_LIBRARY_TEST_LIBRARY_BASE_URL")).origin;
	await page.route("**/api/auth/**", async (route) => {
		if (route.request().method() !== "POST") return route.fallback();
		const response = await route.fetch({ headers: { ...route.request().headers(), origin } });
		await route.fulfill({ response });
	});
}

/** The library's own callback, which OpenScholar returns readers to. */
export function libraryCallbackUrl() {
	return new URL("/api/auth/callback/openscholar", requiredEnvironment("EVIDENCE_LIBRARY_TEST_LIBRARY_BASE_URL")).toString();
}

/**
 * The same session as a Cookie header, for API requests over a plain-HTTP
 * test port, where the browser would not send the library's secure cookies.
 */
export async function readerSessionHeader(clerkUserId: string) {
	const { readerId, cookies } = await mintSession(clerkUserId);
	return { readerId, cookie: cookieHeader(cookies) };
}

export function signInAdmin(page: Page, role: keyof typeof ACCEPTANCE_ADMINS = "editor") {
	return signInAs(page.context(), ACCEPTANCE_ADMINS[role], "Acceptance admin");
}

export async function openAdmin(page: Page, returnPath = "/admin") {
	await signInAdmin(page);
	// The workbench is proven by its controls, not by every asset finishing,
	// so do not wait for the load event before looking for them.
	await page.goto(new URL(returnPath, process.env.PLAYWRIGHT_BASE_URL ?? page.url()).toString(), {
		waitUntil: "domcontentloaded",
	});
	await page.getByRole("button", { name: "Create Item" }).waitFor({ state: "visible" });
}
