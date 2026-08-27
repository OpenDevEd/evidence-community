import type { APIResponse, Page } from "@playwright/test";

export async function issueAdminLoginCode(
	libraryId = process.env.EVIDENCE_LIBRARY_OPENSCHOLAR_LIBRARY_ID,
) {
	const fakeUrl = process.env.EVIDENCE_LIBRARY_OPENSCHOLAR_FAKE_URL;
	if (fakeUrl) {
		const response = await fetch(
			new URL("/_test/admin-login-codes", fakeUrl),
			{
				body: libraryId ? JSON.stringify({ libraryId }) : undefined,
				headers: libraryId
					? { "Content-Type": "application/json" }
					: undefined,
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
): Promise<APIResponse> {
	const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? page.url();
	const url = new URL("/api/admin/session", baseUrl);
	url.searchParams.set("code", code ?? (await issueAdminLoginCode()));
	const response = await page.request.get(url.toString(), {
		maxRedirects: 0,
	});
	if (response.status() !== 303) {
		throw new Error(`Admin login failed with HTTP ${response.status()}`);
	}
	return response;
}

export async function openAdmin(page: Page) {
	await page.goto("/admin");

	const openScholarLink = page.getByRole("link", {
		name: "Back to OpenScholar",
	});
	const newItemButton = page.getByRole("button", { name: "New item" });
	await openScholarLink
		.or(newItemButton)
		.first()
		.waitFor({ state: "visible" });
	if (await openScholarLink.isVisible()) {
		await createAdminBrowserSession(page);
		await page.goto("/admin");
	}

	await newItemButton.waitFor({ state: "visible" });
}
