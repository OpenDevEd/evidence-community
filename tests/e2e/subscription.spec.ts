import { expect, test, type Page } from "@playwright/test";
import { dismissConsent } from "./consent";

const token = process.env.PLAYWRIGHT_SUBSCRIPTION_TOKEN;

async function clickPreferenceTitle(page: Page, name: string) {
	const title = page.getByRole("region", {name: "Email updates", exact: true}).getByText(name, {exact: true});
	await expect(title).toBeVisible();
	// NextUI places the native input over the label. Click at the title's position.
	await title.click({force: true});
}

async function openPreferences(page: Page) {
	if (!token) throw new Error("PLAYWRIGHT_SUBSCRIPTION_TOKEN is required for the seeded subscriber.");
	await page.goto(`/digests/preferences?token=${token}`);
	await dismissConsent(page);
	for (const name of ["Community digests", "New publications"]) {
		const control = page.getByRole("switch", {name, exact: true});
		await expect(control).toBeEnabled();
		if (!await control.isChecked()) await clickPreferenceTitle(page, name);
		await expect(control).toBeChecked();
	}
}

test("preference titles and keyboard input control the actual switches", async ({page}) => {
	await openPreferences(page);
	const digest = page.getByRole("switch", {name: "Community digests", exact: true});
	await clickPreferenceTitle(page, "Community digests");
	await expect(digest).not.toBeChecked();
	await digest.focus();
	await page.keyboard.press("Space");
	await expect(digest).toBeChecked();
});

test("pending saves lock preferences and unsubscribe until the request fails", async ({page}) => {
	await openPreferences(page);
	let release!: () => void;
	const pending = new Promise<void>(resolve => {release = resolve;});
	await page.route("**/api/notifications/subscription", async route => {
		await pending;
		await route.abort("failed");
	});
	await page.getByRole("button", {name: "Save preferences", exact: true}).click();
	try {
		for (const name of ["Community digests", "New publications"]) await expect(page.getByRole("switch", {name, exact: true})).toBeDisabled();
		await expect(page.getByRole("button", {name: "Unsubscribe from all", exact: true})).toBeDisabled();
	} finally {release();}
	await expect(page.getByRole("region", {name: "Email updates", exact: true}).getByRole("alert")).toHaveText(/\S/u);
	await expect(page.getByRole("button", {name: "Save preferences", exact: true})).toBeEnabled();
	await expect(page.getByRole("switch", {name: "Community digests", exact: true})).toBeEnabled();
});

for (const failure of ["offline", "proxy error", "html success", "empty success", "invalid success"] as const) {
	test(`preferences survive ${failure}, clear stale errors on editing and allow retry`, async ({page}) => {
		await openPreferences(page);
		let shouldFail = true;
		let saved: unknown;
		await page.route("**/api/notifications/subscription", async route => {
			if (!shouldFail) {
				saved = route.request().postDataJSON();
				return route.fulfill({json: {ok: true}});
			}
			if (failure === "offline") return route.abort("failed");
			if (failure === "invalid success") return route.fulfill({json: {ok: false}});
			await route.fulfill({status: failure === "proxy error" ? 503 : 200, contentType: "text/html", body: failure === "empty success" ? "" : "<html>wire-error</html>"});
		});
		await page.getByRole("button", {name: "Save preferences", exact: true}).click();
		const alert = page.getByRole("region", {name: "Email updates", exact: true}).getByRole("alert");
		await expect(alert).toHaveText(/\S/u);
		await expect(alert).not.toContainText(/wire-error|<html>/u);
		const digest = page.getByRole("switch", {name: "Community digests", exact: true});
		await expect(digest).toBeChecked();
		await clickPreferenceTitle(page, "Community digests");
		await expect(alert).toHaveCount(0);
		shouldFail = false;
		await page.getByRole("button", {name: "Save preferences", exact: true}).click();
		await expect(page.getByRole("region", {name: "Email updates", exact: true}).getByRole("status")).toHaveText(/\S/u);
		expect(saved).toEqual({action: "preferences", token, digest: false, instant: true});
		await expect(digest).not.toBeChecked();
	});
}
