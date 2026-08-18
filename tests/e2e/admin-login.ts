import type { Page } from "@playwright/test";

export async function openAdmin(
	page: Page,
	password = process.env.EVIDENCE_LIBRARY_ADMIN_PASSWORD ??
		"correct horse battery staple",
) {
	await page.goto("/admin");

	const passwordInput = page.getByRole("textbox", { name: "Admin password" });
	const newItemButton = page.getByRole("button", { name: "New item" });
	await passwordInput.or(newItemButton).first().waitFor({ state: "visible" });
	if (await passwordInput.isVisible()) {
		await passwordInput.fill(password);
		await page.getByRole("button", { name: "Continue" }).click();
	}

	await newItemButton.waitFor({ state: "visible" });
}
