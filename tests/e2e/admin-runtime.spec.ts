import { expect, test } from "@playwright/test";

import { openAdmin } from "./admin-login";

const runtimeE2e = process.env.PLAYWRIGHT_RUNTIME_E2E === "true";
const expectedTitle =
	process.env.PLAYWRIGHT_EXPECTED_ADMIN_ITEM_TITLE ??
	"Amber database evidence";
const expectedKey =
	process.env.PLAYWRIGHT_EXPECTED_DATABASE_ITEM_KEY ?? "AMBR2345";

const protectedAdminRequests = [
	["GET", "/api/admin/publication"],
	["POST", "/api/admin/search-index/retry"],
	["POST", "/api/admin/search-index/receipts"],
	["GET", "/api/admin/library"],
	["GET", "/api/admin/collections"],
	["POST", "/api/admin/collections"],
	["GET", "/api/admin/search-index"],
	["POST", "/api/admin/collections/ABCDEFGH/restore"],
	["PATCH", "/api/admin/collections/ABCDEFGH"],
	["DELETE", "/api/admin/collections/ABCDEFGH"],
	["POST", "/api/admin/collections/ABCDEFGH/move"],
	["POST", "/api/admin/items/drafts"],
	["GET", "/api/admin/items/ABCDEFGH"],
	["POST", "/api/admin/items/batch"],
	["POST", "/api/admin/items/ABCDEFGH/unpublish"],
	["GET", "/api/admin/items/ABCDEFGH/draft"],
	["POST", "/api/admin/items/ABCDEFGH/draft"],
	["PUT", "/api/admin/items/ABCDEFGH/draft"],
	["DELETE", "/api/admin/items/ABCDEFGH/draft"],
	["POST", "/api/admin/items/ABCDEFGH/publication/zenodo/activate"],
	["GET", "/api/admin/items/ABCDEFGH/publication"],
	["POST", "/api/admin/items/ABCDEFGH/publication/crossref/activate"],
	["PUT", "/api/admin/items/ABCDEFGH/writeback/sources"],
	["GET", "/api/admin/items/ABCDEFGH/file"],
	["POST", "/api/admin/items/ABCDEFGH/file"],
	["DELETE", "/api/admin/items/ABCDEFGH/file"],
	["POST", "/api/admin/items/ABCDEFGH/writeback/resolve"],
	["POST", "/api/admin/items/ABCDEFGH/publication/crossref/retry"],
	["POST", "/api/admin/items/ABCDEFGH/publication/zenodo/retry"],
	["GET", "/api/admin/items/ABCDEFGH/writeback/status"],
	["POST", "/api/admin/items/ABCDEFGH/publish"],
	["POST", "/api/admin/items/ABCDEFGH/file/publish"],
	["POST", "/api/admin/items/ABCDEFGH/writeback/retry"],
	["POST", "/api/admin/items/ABCDEFGH/file/complete"],
	["DELETE", "/api/admin/items/ABCDEFGH/file/draft"],
	["GET", "/api/admin/items"],
] as const;

test.skip(!runtimeE2e, "requires the disposable Evidence Library runtime");

test("rejects every protected admin request without a session", async ({
	request,
}) => {
	for (const [method, path] of protectedAdminRequests) {
		await test.step(`${method} ${path}`, async () => {
			const response = await request.fetch(path, {
				failOnStatusCode: false,
				method,
			});
			const message = `${method} ${path}`;

			expect.soft(response.status(), message).toBe(401);
			expect.soft(response.headers()["cache-control"], message).toBe(
				"private, no-store",
			);
			expect.soft(await response.json(), message).toMatchObject({
				error: {
					code: "unauthorized",
				},
			});
		});
	}
});

test("lets an Editor load a record from the real library database", async ({
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

test("lets an Editor create and publish a native record through the real stack", async ({
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
