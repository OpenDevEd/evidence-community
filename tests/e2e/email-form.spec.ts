import { expect, test } from "@playwright/test";
import { dismissConsent } from "./consent";

test("contact validates before sending and exposes field errors", { tag: "@smoke" }, async ({ page }) => {
	test.skip(process.env.PLAYWRIGHT_EXPECTED_EMAIL === "false", "Contact is disabled for this library.");
	await page.goto("/contact");
	await dismissConsent(page);
	const submit = page.locator('form button[type="submit"]');
	const email = page.locator("input#email");
	const description = page.locator("textarea#description");
	await expect(submit).toBeDisabled();
	await email.fill("not-an-email");
	await description.fill("Too short");
	await description.blur();
	await expect(submit).toBeDisabled();
	await expect(page.getByRole("alert").first()).toHaveAccessibleName(/.+/);
	await expect(email).toHaveAttribute("aria-invalid", "true");
	await email.fill("reader@example.org");
	await description.fill("A complete message that is long enough to send.");
	await expect(submit).toBeEnabled();
	await description.clear();
	await expect(submit).toBeDisabled();
});
