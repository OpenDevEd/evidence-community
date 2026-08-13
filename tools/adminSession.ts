export type AdminTestSession = {
	cookieHeader: string;
	name: string;
	value: string;
};

export async function createAdminTestSession(
	baseUrl: string,
	password = process.env.EVIDENCE_LIBRARY_ADMIN_PASSWORD,
): Promise<AdminTestSession> {
	if (!password) {
		throw new Error("EVIDENCE_LIBRARY_ADMIN_PASSWORD is required");
	}

	const body = new FormData();
	body.set("password", password);
	const response = await fetch(`${baseUrl}/api/admin/session`, {
		body,
		method: "POST",
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
