import { clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { chromium } from "@playwright/test";

import { cookieHeader, mintReaderSessionCookies, type ReaderTestSessionTarget } from "./readerTestSession";

export type AdminTestSession = {
	cookieHeader: string;
	cookies: { name: string; value: string }[];
};

function requiredEnvironment(name: string) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required to sign in to a deployed library`);
	return value;
}

function sessionFromHeader(header: string): AdminTestSession {
	const cookies = header.split(/;\s*/u).filter(Boolean).map((part) => {
		const separator = part.indexOf("=");
		if (separator < 1) throw new Error("Expected name=value cookies");
		return { name: part.slice(0, separator), value: part.slice(separator + 1) };
	});
	return { cookieHeader: header, cookies };
}

/** A one-time Clerk sign-in token for the test user, from Clerk's Backend API. */
async function createClerkSignInToken(secretKey: string, userId: string) {
	const response = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
		method: "POST",
		headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
		body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }),
	});
	const body = (await response.json().catch(() => null)) as { token?: string; errors?: unknown } | null;
	if (!response.ok || !body?.token) {
		throw new Error(`Clerk sign-in token request answered HTTP ${response.status}: ${JSON.stringify(body?.errors ?? body)}`);
	}
	return body.token;
}

/**
 * Signs a development Clerk test user in through the library's real flow:
 * /admin starts OAuth, Clerk's sign-in page takes a one-time sign-in token
 * (the testing token gets past bot protection), and the library sets its
 * session cookie on the way back.
 */
async function signInThroughOpenScholar(baseUrl: string) {
	const secretKey = requiredEnvironment("CLERK_SECRET_KEY");
	const publishableKey = requiredEnvironment("CLERK_PUBLISHABLE_KEY");
	const userId = requiredEnvironment("EVIDENCE_LIBRARY_TEST_CLERK_USER_ID");
	await clerkSetup({ secretKey, publishableKey });
	const ticket = await createClerkSignInToken(secretKey, userId);
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext();
		await setupClerkTestingToken({ context });
		const page = await context.newPage();
		await page.goto(new URL("/api/admin/sign-in?return=%2Fadmin", baseUrl).toString());
		const signIn = new URL(page.url());
		signIn.searchParams.set("__clerk_ticket", ticket);
		await page.goto(signIn.toString());
		const library = new URL(baseUrl);
		await page.waitForURL((url) => url.origin === library.origin && /\/admin(?:$|[/?])/u.test(url.pathname), { timeout: 60_000 });
		const cookies = (await context.cookies(library.origin))
			.filter((cookie) => cookie.name.includes("evidence-library."))
			.map(({ name, value }) => ({ name, value }));
		if (!cookies.some((cookie) => cookie.name.endsWith("session_token"))) {
			throw new Error(`Sign-in came back to ${page.url()} without a library session cookie`);
		}
		return { cookieHeader: cookieHeader(cookies), cookies };
	} finally {
		await browser.close();
	}
}

/**
 * A library session for admin calls. `EVIDENCE_LIBRARY_ADMIN_SESSION_COOKIE`
 * reuses one taken from a browser; a local library is signed in through its
 * own database; a deployed one through a development Clerk test user.
 */
export async function createAdminTestSession(
	baseUrl: string,
	local?: ReaderTestSessionTarget & { clerkUserId: string },
): Promise<AdminTestSession> {
	const existing = process.env.EVIDENCE_LIBRARY_ADMIN_SESSION_COOKIE;
	if (existing) return sessionFromHeader(existing);
	if (local) {
		const { cookies } = await mintReaderSessionCookies(local, local.clerkUserId, { name: "Acceptance admin" });
		return { cookieHeader: cookieHeader(cookies), cookies: cookies.map(({ name, value }) => ({ name, value })) };
	}
	return signInThroughOpenScholar(baseUrl);
}

export function withAdminTestSession(
	session: AdminTestSession,
	headers: HeadersInit | undefined,
) {
	const result = new Headers(headers);
	result.set("Cookie", session.cookieHeader);
	return result;
}
