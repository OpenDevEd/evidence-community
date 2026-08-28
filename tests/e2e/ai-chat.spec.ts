import { expect, test, type Page } from "@playwright/test";

test.skip(
	process.env.PLAYWRIGHT_RUNTIME_ACCEPTANCE !== "true",
	"requires a materialized runtime acceptance profile",
);
test.skip(
	process.env.PLAYWRIGHT_EXPECTED_AI_SEARCH !== "true",
	"this library does not offer AI search",
);

/** The reader's own search field on the library page. */
function searchField(page: Page) {
	return page.getByPlaceholder("Search", { exact: true }).first();
}

/** The button that hands what was typed to the assistant. */
function askButton(page: Page) {
	return page.getByRole("button", { name: /Ask AI/ }).first();
}

/** The chat panel beside the results. */
function chatPanel(page: Page) {
	return page.getByRole("region", { name: "Ask AI" });
}

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await page.goto("/en-GB/lib");
	await page
		.getByRole("button", { name: "Decline", exact: true })
		.click({ timeout: 3_000 })
		.catch(() => undefined);
	// The page has to be ready before the reader can type into it.
	await expect(searchField(page)).toBeVisible();
	await expect(askButton(page)).toBeVisible();
});

test("opens the chat beside the results and closes it again", async ({
	page,
}) => {
	await expect(chatPanel(page)).toHaveCount(0);

	await searchField(page).fill("teacher training");
	await expect(searchField(page)).toHaveValue("teacher training");
	await askButton(page).click();

	await expect(chatPanel(page)).toBeVisible();
	// Asking takes the text away from the search field: it is a question now,
	// not a filter.
	await expect(searchField(page)).toHaveValue("");
	await expect(
		chatPanel(page).getByText("teacher training", { exact: false }).first(),
	).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(chatPanel(page)).toHaveCount(0);
	await expect(searchField(page)).toBeFocused();
});

test("opens the chat from the keyboard without leaving the search field", async ({
	page,
}) => {
	await searchField(page).fill("school meals");
	await expect(searchField(page)).toHaveValue("school meals");
	await searchField(page).press("ControlOrMeta+Enter");

	await expect(chatPanel(page)).toBeVisible();
	await expect(
		chatPanel(page).getByText("school meals", { exact: false }).first(),
	).toBeVisible();
	await expect(
		chatPanel(page).getByRole("textbox", { name: "Ask AI" }),
	).toBeVisible();
});
