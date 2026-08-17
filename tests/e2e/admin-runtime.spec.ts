import { expect, test } from "@playwright/test";

import { openAdmin } from "./admin-login";

const runtimeE2e = process.env.PLAYWRIGHT_RUNTIME_E2E === "true";
const expectedTitle =
	process.env.PLAYWRIGHT_EXPECTED_ADMIN_ITEM_TITLE ??
	"Amber database evidence";
const expectedKey =
	process.env.PLAYWRIGHT_EXPECTED_DATABASE_ITEM_KEY ?? "AMBR2345";

test.skip(!runtimeE2e, "requires the disposable Evidence Library runtime");

test("loads an admin record from the real library database", async ({
	page,
}) => {
	await openAdmin(page);
	await page.locator(`[data-record-key="${expectedKey}"]`).click();

	await expect(
		page.getByRole("heading", { name: expectedTitle }),
	).toBeVisible();
	await expect(
		page.getByRole("textbox", { name: "Title", exact: true }),
	).toHaveValue(expectedTitle);
});

test("creates and publishes a native record through the real stack", async ({
	page,
}, testInfo) => {
	const title = `Runtime published book ${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}`;
	await openAdmin(page);

	await page.getByRole("button", { name: "New item" }).click();
	const newItem = page.getByRole("dialog", { name: "New item" });
	await newItem.getByRole("button", { name: "Book", exact: true }).click();

	const inspector = page.locator("#admin-inspector-pane");
	const titleInput = inspector.getByRole("textbox", {
		name: "Title",
		exact: true,
	});
	await titleInput.fill(title);
	await inspector
		.getByRole("button", { name: "Publish", exact: true })
		.click();

	await expect(
		page.getByText("Record published", { exact: true }),
	).toBeVisible({ timeout: 60_000 });
	await expect(titleInput).toHaveValue(title);
	await expect(
		inspector.getByText("Published", { exact: true }).first(),
	).toBeVisible();

	await page.reload();
	const search = page.getByRole("textbox", { name: "Search records" });
	await search.fill(title);
	await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
});
