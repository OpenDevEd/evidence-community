import { expect, test, type Page } from "@playwright/test";
import { dismissConsent } from "./consent";

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
	await dismissConsent(page);
	// The page has to be ready before the reader can type into it.
	await expect(searchField(page)).toBeVisible();
	await expect(askButton(page)).toBeVisible();
});

test("opens the chat beside the results and closes it again", { tag: "@smoke" }, async ({
	page,
}) => {
	await expect(chatPanel(page)).toHaveCount(0);
	const collections = page.getByRole("complementary", {
		name: "Filters and collections",
	});
	await expect(collections).toBeVisible();

	await searchField(page).fill("teacher training");
	await expect(searchField(page)).toHaveValue("teacher training");
	await askButton(page).click();

	await expect(chatPanel(page)).toBeVisible();
	await expect(collections).toHaveCount(0);
	await expect(page.getByRole("tab", { name: /^Results/ })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	// Asking takes the text away from the search field: it is a question now,
	// not a filter.
	await expect(searchField(page)).toHaveValue("");
	await expect(
		chatPanel(page).getByText("teacher training", { exact: false }).first(),
	).toBeVisible();

	await page.keyboard.press("Escape");
	await expect(chatPanel(page)).toHaveCount(0);
	await expect(searchField(page)).toBeFocused();
	await expect(collections).toBeVisible();
	await askButton(page).click();
	await expect(chatPanel(page)).toBeVisible();
	await expect(collections).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(collections).toBeVisible();
});

test("keeps results, sources and filters usable beside the conversation", async ({
	page,
}) => {
	const resultLink = page.locator('#main-content a[href*="/lib/"]').first();
	await expect(resultLink).toBeVisible();
	const href = await resultLink.getAttribute("href");
	const key = href?.match(/\/lib\/([A-Za-z0-9]+)/)?.[1];
	expect(key).toBeTruthy();
	// Only the AI response is fixed. Source cards load the real publication
	// through the app, so a broken source list or link cannot pass this check.
	await page.route("**/api/ai/chat", (route) =>
		route.fulfill({
			contentType: "text/event-stream",
			body: answerStream(`[Publication](/lib/${key})`),
		}),
	);
	await askButton(page).click();
	await expect(chatPanel(page)).toBeVisible();
	const sources = page.getByRole("tab", { name: /^Sources/ });
	await sources.click();
	await expect(sources).toHaveAttribute("aria-selected", "true");
	await expect(sources).toHaveAccessibleName("Sources 0");

	const composer = chatPanel(page).getByRole("textbox", { name: "Ask AI" });
	await composer.fill("Find a publication");
	await composer.press("Enter");
	await expect(sources).toHaveAccessibleName("Sources 1");
	const sourceCard = page
		.locator(`#main-content a[href*="/lib/${key}"]:visible`)
		.last();
	await expect(sourceCard).toBeVisible();
	const popup = page.waitForEvent("popup");
	await sourceCard.click();
	const publication = await popup;
	await expect(publication).toHaveURL(new RegExp(`/lib/${key}`));
	await publication.close();
	await expect(chatPanel(page)).toBeVisible();

	await sources.focus();
	await sources.press("ArrowLeft");
	await expect(page.getByRole("tab", { name: /^Results/ })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.getByRole("button", { name: "Explore", exact: true }).click();
	const filters = page.getByRole("dialog", { includeHidden: true });
	await expect(
		filters.getByRole("complementary", { name: "Filters and collections" }),
	).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(filters).toHaveCount(0);
	await expect(chatPanel(page)).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(chatPanel(page)).toHaveCount(0);
});

test("answers a reader who has turned cookies down", async ({ page }, run) => {
	// The library counts how often one address may ask, by the address the
	// server is told. This run asks from an address of its own, so being told
	// to wait can never stand in for the question being taken.
	await page.setExtraHTTPHeaders({
		"x-real-ip": `10.${run.retry}.${run.workerIndex}.${run.repeatEachIndex + 1}`,
	});

	// Turning cookies down leaves the reader with no analytics id. The
	// library used to refuse every question such a reader asked.
	const asked = page.waitForResponse(
		(response) =>
			response.url().includes("/api/ai/chat") &&
			response.request().method() === "POST",
	);

	await searchField(page).fill("teacher training");
	await askButton(page).click();

	const answer = await asked;
	expect(answer.status()).toBe(200);
	await expect(chatPanel(page)).toBeVisible();
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

function answerStream(answer: string) {
	return (
		[
			{ type: "start", messageId: "publication-answer" },
			{ type: "text-start", id: "answer" },
			{ type: "text-delta", id: "answer", delta: answer },
			{ type: "text-end", id: "answer" },
			{ type: "finish" },
		]
			.map((part) => `data: ${JSON.stringify(part)}\n\n`)
			.join("") + "data: [DONE]\n\n"
	);
}

/**
 * Picks an entry from a publication's AI menu straight after the chat window closed. The window hands focus back as it
 * goes, and a test clicks faster than a reader can: a click in that moment can open and close the menu at once, so the
 * menu is opened again until it stays open. One that never opens still fails.
 */
async function reopenAIMenu(page: Page, feature: RegExp) {
	const trigger = page.getByRole("button", { name: "AI menu", exact: true });
	const entry = page.getByRole("menuitem", { name: feature });
	await expect(async () => {
		if (!(await entry.isVisible())) await trigger.click();
		await expect(trigger).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
		await entry.click({ timeout: 2_000 });
	}).toPass({ timeout: 15_000 });
}

async function openPublicationAI(page: Page, feature: RegExp) {
	const publication = page.locator('#main-content a[href*="/lib/"]').first();
	const href = await publication.getAttribute("href");
	await publication.click();
	await expect(page).toHaveURL(new RegExp(href!.match(/\/lib\/[^/?#]+/)![0]));
	await expect(
		page.getByRole("main").getByRole("heading", { level: 1 }),
	).toBeVisible();
	// A reader's first click opens the menu and it stays open.
	const trigger = page.getByRole("button", { name: "AI menu", exact: true });
	await trigger.click();
	await expect(trigger).toHaveAttribute("aria-expanded", "true");
	await page.getByRole("menuitem", { name: feature }).click();
}

for (const feature of ["Summarise", "Explain"]) {
	test(`keeps the pending ${feature} request in history until the reader deletes it`, async ({
		page,
	}) => {
		let finishRequest!: () => void;
		const pending = new Promise<void>((resolve) => {
			finishRequest = resolve;
		});
		await page.route("**/api/ai", async (route) => {
			await pending;
			await route.fulfill({
				contentType: "text/event-stream",
				body: answerStream(
					"## Findings\n\nThe publication describes the evidence.",
				),
			});
		});
		await openPublicationAI(page, new RegExp(`^${feature}`));
		const history = page.getByRole("listbox", { name: "History" });
		const remove = page.getByRole("button", {
			name: "Delete history item",
			exact: true,
		});
		await expect(history.getByRole("option")).toHaveCount(1);
		await expect(remove).toBeDisabled();
		finishRequest();
		await expect(
			page.getByRole("heading", { name: "Findings", exact: true }),
		).toBeVisible();
		await expect(remove).toBeEnabled();
		await page
			.getByRole("button", { name: "Close this popup", exact: true })
			.click();
		await page
			.getByRole("dialog", { includeHidden: true })
			.waitFor({ state: "detached" });
		await reopenAIMenu(page, new RegExp(`^${feature}`));
		await expect(
			page.getByRole("heading", { name: "Findings", exact: true }),
		).toBeVisible();
		await expect(history.getByRole("option")).toHaveCount(1);
		await remove.click();
		await expect(history.getByRole("option")).toHaveCount(0);
		await expect(
			page.getByRole("heading", { name: "Findings", exact: true }),
		).toHaveCount(0);
	});
}

test("lets the reader delete a failed generation and start again", async ({
	page,
}) => {
	await page.route("**/api/ai", (route) =>
		route.fulfill({
			status: 503,
			body: "The selected model is unavailable.",
		}),
	);
	await openPublicationAI(page, /^Explain/);
	await expect(page.getByRole("alert")).toContainText(
		"The selected model is unavailable.",
	);
	await page
		.getByRole("button", { name: "Delete history item", exact: true })
		.click();
	await expect(
		page.getByRole("listbox", { name: "History" }).getByRole("option"),
	).toHaveCount(0);
	await expect(page.getByRole("alert")).toHaveCount(0);
	await page
		.getByRole("button", { name: "Close this popup", exact: true })
		.click();
	await page
		.getByRole("dialog", { includeHidden: true })
		.waitFor({ state: "detached" });
	await page.unroute("**/api/ai");
	await page.route("**/api/ai", (route) =>
		route.fulfill({
			contentType: "text/event-stream",
			body: answerStream("The new explanation is ready."),
		}),
	);
	await reopenAIMenu(page, /^Explain/);
	await expect(
		page.getByText("The new explanation is ready.", { exact: true }),
	).toBeVisible();
});

test("turns starter questions into a publication conversation and restores them on reset", async ({
	page,
}) => {
	const questions = [
		"What are the findings?",
		"What methods were used?",
		"What are the limitations?",
		"Who is the audience?",
		"What should happen next?",
	];
	await page.route("**/api/ai/questions", (route) =>
		route.fulfill({ json: questions }),
	);
	await page.route("**/api/ai/chat", (route) =>
		route.fulfill({
			contentType: "text/event-stream",
			body: answerStream("The publication has useful findings."),
		}),
	);
	await openPublicationAI(page, /^Ask AI/);
	const question = page.getByRole("button", {
		name: questions[0],
		exact: true,
	});
	await question.click();
	const composer = page.getByRole("textbox", { name: "Ask AI" });
	await expect(composer).toHaveValue(questions[0]);
	await composer.press("Enter");
	await expect(
		page.getByText("The publication has useful findings.", { exact: true }),
	).toBeVisible();
	await expect(question).toHaveCount(0);
	await page.getByRole("button", { name: "Reset", exact: true }).click();
	await expect(question).toBeVisible();
	await expect(
		page.getByText("The publication has useful findings.", { exact: true }),
	).toHaveCount(0);
});
