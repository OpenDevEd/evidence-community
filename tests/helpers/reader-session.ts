/**
 * Stands in for `@/lib/readers/session` in unit tests: a request is signed in
 * as the Clerk user named in its `test-reader` cookie. Tests that need the
 * real Better Auth session use the integration helpers instead.
 */
const TEST_READER_COOKIE = "test-reader";

export function signedInHeaders(clerkUserId?: string) {
	const headers = new Headers();
	if (clerkUserId) headers.set("cookie", `${TEST_READER_COOKIE}=${encodeURIComponent(clerkUserId)}`);
	return headers;
}

export async function getSignedInReader(headers?: Headers) {
	// Like the real session, a call without headers reads the current request's.
	const requestHeaders = headers ?? (await (await import("next/headers")).headers());
	const cookie = requestHeaders.get("cookie") ?? "";
	const match = new RegExp(`(?:^|;\\s*)${TEST_READER_COOKIE}=([^;]+)`).exec(cookie);
	if (!match) return null;
	const clerkUserId = decodeURIComponent(match[1]!);
	return { id: `reader-${clerkUserId}`, name: "Test reader", image: null, clerkUserId };
}

export async function getSignedInOpenScholarUser(headers?: Headers) {
	return getSignedInReader(headers);
}
