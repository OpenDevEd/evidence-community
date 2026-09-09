export type AdminTestSession = {
	cookieHeader: string;
	name: string;
	value: string;
};

export async function createAdminTestSession(
	baseUrl: string,
	code = process.env.EVIDENCE_LIBRARY_ADMIN_LOGIN_CODE,
): Promise<AdminTestSession> {
	const existingCookie = process.env.EVIDENCE_LIBRARY_ADMIN_SESSION_COOKIE;
	if (existingCookie) {
		const separator = existingCookie.indexOf("=");
		if (separator < 1 || existingCookie.includes(";")) throw new Error("Expected a single admin session cookie");
		return {cookieHeader: existingCookie, name: existingCookie.slice(0, separator), value: existingCookie.slice(separator + 1)};
	}
	if (!code) {
		throw new Error("EVIDENCE_LIBRARY_ADMIN_LOGIN_CODE is required");
	}

	const url = new URL("/api/admin/session", baseUrl);
	url.searchParams.set("code", code);
	const response = await fetch(url, {
		redirect: "manual",
	});
	if (response.status !== 303) {
		throw new Error(`Admin login failed with HTTP ${response.status}`);
	}

	const setCookie = response.headers.get("set-cookie");
	const cookieHeader = setCookie?.split(";", 1)[0];
	const separator = cookieHeader?.indexOf("=") ?? -1;
	if (!cookieHeader || separator < 1) {
		throw new Error("Admin login did not return a session cookie");
	}
	return {
		cookieHeader,
		name: cookieHeader.slice(0, separator),
		value: cookieHeader.slice(separator + 1),
	};
}

export function withAdminTestSession(
	session: AdminTestSession,
	headers: HeadersInit | undefined,
) {
	const result = new Headers(headers);
	result.set("Cookie", session.cookieHeader);
	return result;
}
