import { expect, type Page } from "@playwright/test";

/** How long the consent dialog is given to appear after the page loads. */
const CONSENT_APPEARS_WITHIN_MS = 15_000;

/**
 * Answers the analytics consent dialog and waits until it is gone.
 *
 * The dialog holds the keyboard while it is open, so anything typed before it
 * is answered goes to the dialog instead of the page. It is also drawn a
 * moment after the page becomes usable, so a check that merely looks for it
 * once can miss it and leave it holding the keyboard for the whole test.
 *
 * A library that does not ask for consent is fine: nothing appears and
 * nothing is waited for.
 */
export async function dismissConsent(page: Page) {
	const dialog = page.getByRole("dialog");

	await dialog
		.first()
		.waitFor({ state: "visible", timeout: CONSENT_APPEARS_WITHIN_MS })
		.catch(() => undefined);
	if ((await dialog.count()) === 0) return;

	await page.getByRole("button", { name: "Decline", exact: true }).click();
	await expect(dialog).toHaveCount(0);
}
