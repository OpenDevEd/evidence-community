import { expect, test, type Page } from "@playwright/test";

import { openAdmin } from "./admin-login";

const runtimeE2e = process.env.PLAYWRIGHT_RUNTIME_E2E === "true";

test.skip(!runtimeE2e, "requires the disposable Evidence Library runtime");

async function createPublishedBook(page: Page, title: string) {
	await page.getByRole("button", { name: "New item" }).click();
	const newItem = page.getByRole("dialog", { name: "New item" });
	await newItem.getByRole("button", { name: "Book", exact: true }).click();
	const inspector = page.locator("#admin-inspector-pane");
	const titleInput = inspector.getByRole("textbox", { name: "Title", exact: true });
	await expect(titleInput).toBeEnabled({ timeout: 30_000 });
	await expect(titleInput).toHaveValue("");
	await titleInput.fill(title);
	await inspector.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(inspector.getByRole("button", { name: "Edit" })).toBeVisible({
		timeout: 60_000,
	});
	const key = await inspector
		.locator("h2 + p")
		.first()
		.evaluate((node) => node.textContent?.trim().split("·").pop()?.trim() ?? "");
	expect(key).toMatch(/^[23456789A-NP-Z]{8}$/);
	return key;
}

async function publicCitedBy(page: Page, key: string) {
	const response = await page.request.get(`/api/item/${key}`);
	if (!response.ok()) return null;
	const body = (await response.json()) as {
		item: { links?: { citedBy: string[] } } | null;
	};
	return body.item?.links?.citedBy ?? null;
}

async function openRecord(page: Page, key: string) {
	await page.reload();
	const search = page.getByRole("textbox", { name: "Search records" });
	await search.fill(key);
	const row = page.locator(`[data-record-key="${key}"]`);
	await expect(row).toBeVisible({ timeout: 30_000 });
	await row.click();
	const inspector = page.locator("#admin-inspector-pane");
	await expect(inspector.getByRole("group", { name: "Links" })).toBeVisible();
	return inspector;
}

test("links two records, shows both sides, and removes the link again", async ({
	page,
}, testInfo) => {
	const stamp = `${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}`;
	const citingTitle = `Link e2e citing ${stamp}`;
	const citedTitle = `Link e2e cited ${stamp}`;
	await openAdmin(page);

	const citedKey = await createPublishedBook(page, citedTitle);
	const citingKey = await createPublishedBook(page, citingTitle);

	// Add: citing → cited, by picking the cited record straight from the record table
	let inspector = await openRecord(page, citingKey);
	await inspector.getByRole("button", { name: "Edit" }).click();
	const links = inspector.getByRole("group", { name: "Links" });
	await links.getByRole("button", { name: "Add to Cites" }).click();
	const banner = page.locator('[data-admin-link-pick-banner="cites"]');
	await expect(banner).toContainText("Click records to add them under Cites");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await page.getByRole("textbox", { name: "Search records" }).fill(citedTitle);
	const citedRow = page.locator(`[data-record-key="${citedKey}"]`);
	await expect(citedRow).toBeVisible({ timeout: 30_000 });
	await citedRow.click();
	// Picking must not switch the inspector away from the citing record
	await expect(inspector.getByRole("heading", { name: citingTitle })).toBeVisible();
	await banner.getByRole("button", { name: "Done" }).click();
	await expect(banner).toHaveCount(0);
	// The open record stays in the inspector even though the search hides it
	await expect(inspector.getByRole("heading", { name: citingTitle })).toBeVisible();

	// Checked rows can be added in one go (here: the same record under Related)
	await links.getByRole("button", { name: "Add to Related" }).click();
	const relatedBanner = page.locator('[data-admin-link-pick-banner="related"]');
	await expect(relatedBanner).toBeVisible();
	await page.getByRole("checkbox", { name: `Select ${citedTitle}` }).check();
	await relatedBanner.getByRole("button", { name: "Add 1 checked" }).click();
	await expect(
		links.locator(`[data-admin-link-list="related"] [data-admin-link-key="${citedKey}"]`),
	).toHaveAttribute("data-admin-link-change", "added");
	await page.keyboard.press("Escape");
	await expect(relatedBanner).toHaveCount(0);
	await page.getByRole("textbox", { name: "Search records" }).fill("");

	const addedRow = links.locator(
		`[data-admin-link-list="cites"] [data-admin-link-key="${citedKey}"]`,
	);
	await expect(addedRow).toHaveAttribute("data-admin-link-change", "added");
	await expect(addedRow).toContainText(citedTitle);
	await expect(
		inspector.getByRole("button", { name: "Changed: show published links" }),
	).toBeVisible();

	await inspector.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(inspector.getByRole("button", { name: "Edit" })).toBeVisible({
		timeout: 60_000,
	});
	await expect(addedRow).toHaveAttribute("data-admin-link-change", "unchanged");
	await expect(
		inspector.getByRole("button", { name: "Changed: show published links" }),
	).toHaveCount(0);

	// The other side sees "Cited by"
	inspector = await openRecord(page, citedKey);
	const citedBy = inspector.locator('[data-admin-link-incoming="cites"]');
	await expect(citedBy).toContainText(citingTitle);
	await expect(citedBy.locator(`[data-admin-link-key="${citingKey}"]`)).toHaveAttribute(
		"data-admin-link-origin",
		"manual",
	);
	await expect(citedBy.getByRole("button")).toHaveCount(0);

	// Public API of the cited record lists the citing record once caches clear
	await expect
		.poll(() => publicCitedBy(page, citedKey), { timeout: 60_000 })
		.toEqual([citingKey]);

	// Remove, revert, remove again, publish
	inspector = await openRecord(page, citingKey);
	await inspector.getByRole("button", { name: "Edit" }).click();
	const removeButton = inspector.getByRole("button", {
		name: `Remove ${citedTitle} from Cites`,
	});
	await removeButton.click();
	const removedRow = inspector.locator(
		`[data-admin-link-list="cites"] [data-admin-link-key="${citedKey}"]`,
	);
	await expect(removedRow).toHaveAttribute("data-admin-link-change", "removed");
	await inspector
		.getByRole("button", { name: "Changed: show published links" })
		.click();
	await page.getByRole("button", { name: "Revert to published" }).click();
	await expect(removedRow).toHaveAttribute("data-admin-link-change", "unchanged");

	await removeButton.click();
	await expect(removedRow).toHaveAttribute("data-admin-link-change", "removed");
	await inspector.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(inspector.getByRole("button", { name: "Edit" })).toBeVisible({
		timeout: 60_000,
	});
	await expect(removedRow).toHaveCount(0);

	await expect
		.poll(() => publicCitedBy(page, citedKey), { timeout: 60_000 })
		.toEqual([]);
});
