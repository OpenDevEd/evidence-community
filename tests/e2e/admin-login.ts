import type { BrowserContext, Page } from "@playwright/test";

import { mintReaderSessionCookies } from "../../tools/readerTestSession";

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
export async function signInAs(context: BrowserContext, clerkUserId: string, name?: string) {
	const { readerId, cookies } = await mintReaderSessionCookies(
		{
			databaseUrl: requiredEnvironment("EVIDENCE_LIBRARY_TEST_DATABASE_URL"),
			secret: requiredEnvironment("EVIDENCE_LIBRARY_TEST_AUTH_SECRET"),
			libraryBaseUrl: requiredEnvironment("EVIDENCE_LIBRARY_TEST_LIBRARY_BASE_URL"),
		},
		clerkUserId,
		{ name, cookieDomain: new URL(requiredEnvironment("PLAYWRIGHT_BASE_URL")).hostname },
	);
	await context.addCookies(cookies.map((cookie) => ({ ...cookie, sameSite: cookie.sameSite ?? "Lax" })));
	return readerId;
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
