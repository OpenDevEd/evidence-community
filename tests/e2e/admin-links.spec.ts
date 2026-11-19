import { expect, test, type Page } from "@playwright/test";

import { openAdmin } from "./admin-login";
import { publishWorkingDraft } from "./admin-review";

const runtimeE2e = process.env.PLAYWRIGHT_RUNTIME_E2E === "true";

test.skip(!runtimeE2e, "requires the disposable Evidence Library runtime");

async function createPublishedBook(page: Page, title: string) {
	await page.getByRole("button", { name: "Create Item" }).click();
	const newItem = page.getByRole("dialog", { name: "Create Item" });
	await newItem.getByRole("button", { name: "Book", exact: true }).click();
	const inspector = page.locator("#admin-inspector-pane");
	const titleInput = inspector.getByRole("textbox", { name: "Title", exact: true });
	await expect(titleInput).toBeEnabled({ timeout: 30_000 });
	await expect(titleInput).toHaveValue("");
	await titleInput.fill(title);
	await publishWorkingDraft(page);
	await expect(inspector.getByRole("button", { name: "Edit", exact: true })).toBeVisible({
		timeout: 60_000,
	});
	const key = new URL(page.url()).searchParams.get("item") ?? "";
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
	// Real stack: several publishes wait for search receipts, so give the flow room.
	test.setTimeout(180_000);
	const stamp = `${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}`;
	const citingTitle = `Link e2e citing ${stamp}`;
	const citedTitle = `Link e2e cited ${stamp}`;
	await openAdmin(page);

	const citedKey = await createPublishedBook(page, citedTitle);
	const citingKey = await createPublishedBook(page, citingTitle);

	// Add: citing → cited, by picking the cited record straight from the record table
	let inspector = await openRecord(page, citingKey);
	await inspector.getByRole("button", { name: "Edit", exact: true }).click();
	const links = inspector.getByRole("group", { name: "Links", includeHidden: true });
	await links.getByRole("button", { name: "Add to References" }).click();
	const banner = page.locator('[data-admin-link-pick-banner="cites"]');
	await expect(banner).toContainText("Tick or click records to add them under References");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await page.getByRole("textbox", { name: "Search records" }).fill(citedTitle);
	const citedRow = page.locator(`[data-record-key="${citedKey}"]`);
	await expect(citedRow).toBeVisible({ timeout: 30_000 });
	await citedRow.click();
	// Picking keeps the citing record selected while mobile users see the list.
	await expect.poll(() => new URL(page.url()).searchParams.get("item")).toBe(citingKey);
	// A second click on the same row toggles the link off again, a third adds it back
	const citesRow = links.locator(
		`[data-admin-link-list="cites"] [data-admin-link-key="${citedKey}"]`,
	);
	await expect(citesRow).toHaveAttribute("data-admin-link-change", "added");
	await citedRow.click();
	await expect(citesRow).toHaveCount(0);
	await citedRow.click();
	await expect(citesRow).toHaveAttribute("data-admin-link-change", "added");
	await banner.getByRole("button", { name: "Done" }).click();
	await expect(banner).toHaveCount(0);
	// The open record stays in the inspector even though the search hides it
	await expect(inspector.getByRole("heading", { name: citingTitle })).toBeVisible();

	// The checkboxes add and remove links while picking (here: the same record under Related)
	await links.getByRole("button", { name: "Related", exact: true }).click();
	await links.getByRole("button", { name: "Add to Related" }).click();
	const relatedBanner = page.locator('[data-admin-link-pick-banner="related"]');
	await expect(relatedBanner).toBeVisible();
	// The record being edited cannot be picked for itself
	await page.getByRole("textbox", { name: "Search records" }).fill(`Link e2e citing ${stamp}`);
	await expect(page.getByRole("checkbox", { name: `Select ${citingTitle}` })).toBeDisabled();
	await page.getByRole("textbox", { name: "Search records" }).fill(citedTitle);
	const citedCheckbox = page.getByRole("checkbox", { name: `Select ${citedTitle}` });
	await expect(citedCheckbox).not.toBeChecked();
	await citedCheckbox.check();
	const relatedRow = links.locator(
		`[data-admin-link-list="related"] [data-admin-link-key="${citedKey}"]`,
	);
	await expect(relatedRow).toHaveAttribute("data-admin-link-change", "added");
	await expect(citedCheckbox).toBeChecked();
	await citedCheckbox.uncheck();
	await expect(relatedRow).toHaveCount(0);
	await citedCheckbox.check();
	await expect(relatedRow).toHaveAttribute("data-admin-link-change", "added");
	await page.getByRole("textbox", { name: "Search records" }).fill("");
	await page.keyboard.press("Escape");
	await expect(relatedBanner).toHaveCount(0);

	await links.getByRole("button", { name: "References", exact: true }).click();
	const addedRow = links.locator(
		`[data-admin-link-list="cites"] [data-admin-link-key="${citedKey}"]`,
	);
	await expect(addedRow).toHaveAttribute("data-admin-link-change", "added");
	await expect(addedRow).toContainText(citedTitle);
	await expect(
		inspector.getByRole("button", { name: "Changed: show published links" }),
	).toBeVisible();

	await publishWorkingDraft(page);
	await expect(inspector.getByRole("button", { name: "Edit", exact: true })).toBeVisible({
		timeout: 60_000,
	});
	await expect(addedRow).toHaveAttribute("data-admin-link-change", "unchanged");
	await expect(
		inspector.getByRole("button", { name: "Changed: show published links" }),
	).toHaveCount(0);

	// Clicking a linked title opens that record in the editor
	await links
		.locator('[data-admin-link-list="cites"]')
		.getByRole("button", { name: `Open ${citedTitle}` })
		.click();
	await expect(inspector.getByRole("heading", { name: citedTitle })).toBeVisible();

	// The other side sees "Citations"
	inspector = await openRecord(page, citedKey);
	await inspector.getByRole("button", { name: "Citations", exact: true }).click();
	const citedBy = inspector.locator('[data-admin-link-list="citedBy"]');
	await expect(citedBy).toContainText(citingTitle);
	await expect(citedBy.locator(`[data-admin-link-key="${citingKey}"]`)).toHaveAttribute(
		"data-admin-link-origin",
		"manual",
	);
	await expect(citedBy.getByRole("button", { name: /^Remove/ })).toHaveCount(0);

	// "Related" is one link: the other side lists it in its own Related list and can remove it
	await inspector.getByRole("button", { name: "Related", exact: true }).click();
	const otherSideRelated = inspector.locator(
		`[data-admin-link-list="related"] [data-admin-link-key="${citingKey}"]`,
	);
	await expect(otherSideRelated).toHaveAttribute("data-admin-link-change", "unchanged");
	await inspector.getByRole("button", { name: "Edit", exact: true }).click();
	await inspector.getByRole("button", { name: `Remove ${citingTitle} from Related` }).click();
	await expect(otherSideRelated).toHaveAttribute("data-admin-link-change", "removed");
	await publishWorkingDraft(page);
	await expect(inspector.getByRole("button", { name: "Edit", exact: true })).toBeVisible({
		timeout: 60_000,
	});
	await expect(otherSideRelated).toHaveCount(0);

	// Public API of the cited record lists the citing record once caches clear
	await expect
		.poll(() => publicCitedBy(page, citedKey), { timeout: 60_000 })
		.toEqual([citingKey]);

	// Remove, revert, remove again, publish
	inspector = await openRecord(page, citingKey);
	await inspector.getByRole("button", { name: "Related", exact: true }).click();
	await expect(
		inspector.locator(`[data-admin-link-list="related"] [data-admin-link-key="${citedKey}"]`),
	).toHaveCount(0);
	await inspector.getByRole("button", { name: "Edit", exact: true }).click();
	await inspector.getByRole("button", { name: "References", exact: true }).click();
	const removeButton = inspector.getByRole("button", {
		name: `Remove ${citedTitle} from References`,
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
	await publishWorkingDraft(page);
	await expect(inspector.getByRole("button", { name: "Edit", exact: true })).toBeVisible({
		timeout: 60_000,
	});
	await expect(removedRow).toHaveCount(0);

	await expect
		.poll(() => publicCitedBy(page, citedKey), { timeout: 60_000 })
		.toEqual([]);
});
