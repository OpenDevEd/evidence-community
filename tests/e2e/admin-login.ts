import type { APIResponse, Page } from "@playwright/test";

export async function issueAdminLoginCode(
	libraryId = process.env.EVIDENCE_LIBRARY_OPENSCHOLAR_LIBRARY_ID,
	role: "owner" | "editor" | "creator" = "editor",
) {
	const fakeUrl = process.env.EVIDENCE_LIBRARY_OPENSCHOLAR_FAKE_URL;
	if (fakeUrl) {
		const response = await fetch(
			new URL("/_test/admin-login-codes", fakeUrl),
			{
				body: JSON.stringify({ libraryId, role }),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			},
		);
		if (!response.ok) {
			throw new Error(
				`OpenScholar test code request failed with HTTP ${response.status}`,
			);
		}
		const body = (await response.json()) as { code?: unknown };
		if (typeof body.code !== "string") {
			throw new Error(
				"OpenScholar test code response did not include a code",
			);
		}
		return body.code;
	}

	const code = process.env.EVIDENCE_LIBRARY_ADMIN_LOGIN_CODE;
	if (!code) {
		throw new Error(
			"EVIDENCE_LIBRARY_ADMIN_LOGIN_CODE or EVIDENCE_LIBRARY_OPENSCHOLAR_FAKE_URL is required",
		);
	}
	return code;
}

export async function createAdminBrowserSession(
	page: Page,
	code?: string,
	returnPath?: string,
): Promise<APIResponse> {
	const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? page.url();
	const url = new URL("/api/admin/session", baseUrl);
	url.searchParams.set("code", code ?? (await issueAdminLoginCode()));
	if (returnPath) url.searchParams.set("return", returnPath);
	const response = await page.request.get(url.toString(), {
		maxRedirects: 0,
	});
	if (response.status() !== 303) {
		throw new Error(`Admin login failed with HTTP ${response.status()}`);
	}
	return response;
}

export async function openAdmin(page: Page, returnPath = "/admin") {
	const response = await createAdminBrowserSession(
		page,
		undefined,
		returnPath,
	);
	const destination = response.headers().location;
	const expectedDestination = new URL(
		returnPath,
		process.env.PLAYWRIGHT_BASE_URL ?? page.url(),
	).toString();
	if (destination !== expectedDestination) {
		throw new Error(
			`Admin login sent the browser to ${destination} instead of ${expectedDestination}`,
		);
	}

	// The workbench is proven by its controls, not by every asset finishing,
	// so do not wait for the load event before looking for them.
	await page.goto(destination, { waitUntil: "domcontentloaded" });
	await page
		.getByRole("button", { name: "Create Item" })
		.waitFor({ state: "visible" });
}
