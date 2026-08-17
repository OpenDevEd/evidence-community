import type { Page } from "@playwright/test";

export async function openAdmin(
	page: Page,
	password = process.env.EVIDENCE_LIBRARY_ADMIN_PASSWORD ??
		"correct horse battery staple",
) {
	await page.goto("/admin");

	const passwordInput = page.getByRole("textbox", { name: "Admin password" });
	if (await passwordInput.isVisible()) {
		await passwordInput.fill(password);
		await page.getByRole("button", { name: "Continue" }).click();
	}
}
