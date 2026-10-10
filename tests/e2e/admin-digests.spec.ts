import { expect, test, type Page } from "@playwright/test";

import { ACCEPTANCE_ADMINS, openAdmin, signInAs } from "./admin-login";
import { dismissConsent } from "./consent";

const runtimeE2e = process.env.PLAYWRIGHT_RUNTIME_E2E === "true";
const editionId = process.env.PLAYWRIGHT_ADMIN_DIGEST_ID ?? "";

test.skip(!runtimeE2e || !editionId, "requires the disposable Evidence Library runtime and its digest fixture");

const saved = (page: Page, method: "PUT" | "POST") =>
	page.waitForResponse((response) => response.url().includes(`/api/admin/digests/${editionId}`) && response.request().method() === method && response.ok());

test("a Creator's change to a digest reaches readers only once an Editor publishes it", { tag: "@smoke" }, async ({ page, browser }) => {
	test.setTimeout(120_000);
	const title = `Homework and feedback, read closely ${Date.now()}`;
	const note = "Start with the study of next-day feedback.";

	// The Creator changes the title, adds a note and sends the digest for review.
	const creatorContext = await browser.newContext();
	await signInAs(creatorContext, ACCEPTANCE_ADMINS.creator, "Acceptance creator");
	const creator = await creatorContext.newPage();
	await creator.goto(new URL(`/admin?digests=${editionId}`, process.env.PLAYWRIGHT_BASE_URL).toString(), { waitUntil: "domcontentloaded" });
	const inspector = creator.locator("#admin-inspector-pane");
	const titleBox = creator.getByRole("textbox", { name: "Title", exact: true });
	await expect(titleBox).not.toHaveValue("");
	const titleSaved = saved(creator, "PUT");
	await titleBox.fill(title);
	await titleSaved;
	const noteSaved = saved(creator, "PUT");
	await inspector.getByRole("textbox", { name: "Editor's note" }).fill(note);
	await noteSaved;
	await expect(inspector.getByText("Draft", { exact: true })).toBeVisible();
	// A Creator is offered no way to publish.
	await expect(inspector.getByRole("button", { name: /Publish/ })).toHaveCount(0);
	await inspector.getByRole("button", { name: "Send for review" }).click();
	await expect(inspector.getByText("In review", { exact: true })).toBeVisible();
	await expect(inspector.getByText("Waiting for an editor")).toBeVisible();
	await creatorContext.close();

	// Readers still have the published text.
	const reader = await (await browser.newContext()).newPage();
	await reader.goto(new URL(`/digests/${editionId}`, process.env.PLAYWRIGHT_BASE_URL).toString());
	await dismissConsent(reader);
	await expect(reader.getByRole("heading", { level: 1 })).not.toContainText("read closely");

	// The Editor finds it waiting, sees what changed, and publishes it.
	await openAdmin(page, "/admin?digests=list");
	const row = page.getByRole("button", { name: new RegExp(title) });
	await expect(row).toContainText("In review");
	await row.click();
	await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(title);
	await page.getByRole("button", { name: /^Changes/ }).click();
	await expect(page.locator("ins").filter({ hasText: "closely" })).toBeVisible();
	const published = saved(page, "POST");
	await page.locator("#admin-inspector-pane").getByRole("button", { name: "Publish changes" }).click();
	await published;
	await expect(page.locator("#admin-inspector-pane").getByText("Published", { exact: true })).toBeVisible();
	await expect(page.locator("#admin-inspector-pane").getByText("published it")).toBeVisible();

	await reader.reload();
	await expect(reader.getByRole("heading", { level: 1 })).toHaveText(title);
	await reader.context().close();
});
