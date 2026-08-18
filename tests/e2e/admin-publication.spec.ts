import { expect, test, type Locator, type Page } from "@playwright/test";

import { openAdmin } from "./admin-login";

const itemKey = process.env.PLAYWRIGHT_PUBLICATION_ITEM_KEY ?? "";
const expectedDoi = process.env.PLAYWRIGHT_PUBLICATION_EXPECTED_DOI ?? "";
const editedTitle = process.env.PLAYWRIGHT_PUBLICATION_EDITED_TITLE ?? "";
const phase = process.env.PLAYWRIGHT_PUBLICATION_PHASE ?? "";

test.skip(!itemKey || !expectedDoi || !phase, "Real publication fixture is not configured");

async function openPublicationRecord(page: Page) {
	await openAdmin(page);
	const row = page.locator(`[data-record-key="${itemKey}"]`);
	await expect(row).toBeVisible();
	await row.click();
	const inspector = page.locator("#admin-inspector-pane");
	await expect(
		inspector.getByRole("heading", { name: "DOI publishing", exact: true }),
	).toBeVisible();
	return inspector;
}

async function dismissConsent(page: Page) {
	await page
		.getByRole("button", { name: "Decline", exact: true })
		.click({ timeout: 3_000 })
		.catch(() => undefined);
}

async function expectCompactDialog(page: Page, dialog: Locator) {
	await expect(dialog).toBeVisible();
	await expect
		.poll(() =>
			dialog.evaluate((element) => ({
				opacity: getComputedStyle(element).opacity,
				width: Math.round(element.getBoundingClientRect().width),
			})),
		)
		.toEqual({ opacity: "1", width: 384 });
	const geometry = await dialog.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return {
			documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
			left: rect.left,
			maxWidth: getComputedStyle(element).maxWidth,
			right: rect.right,
		};
	});
	expect(geometry.documentOverflow).toBe(0);
	expect(geometry.maxWidth).toBe("384px");
	expect(geometry.left).toBeGreaterThanOrEqual(12);
	expect(geometry.right).toBeLessThanOrEqual(
		await page.evaluate(() => window.innerWidth - 12),
	);
}

test("reserves a Crossref DOI from the admin interface", async ({ page }, testInfo) => {
	test.skip(phase !== "reserve", "Reservation phase only");
	const inspector = await openPublicationRecord(page);
	const publication = inspector.locator("#admin-doi-publishing");
	const crossref = publication.locator(
		'[data-admin-publication-provider="crossref"]',
	);

	await crossref
		.getByRole("button", { name: "Activate Crossref DOI" })
		.click();
	const dialog = page.getByRole("dialog", { name: "Activate Crossref DOI" });
	await expectCompactDialog(page, dialog);
	await expect(dialog.getByText("10.5555/acceptance.…")).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath("crossref-dialog.png"), fullPage: true });

	await dialog.getByRole("button", { name: "Activate DOI" }).click();
	await expect(dialog).toBeHidden();
	await expect(crossref.getByRole("link", { name: expectedDoi })).toBeVisible();
	await expect(crossref.getByText("Queued", { exact: true })).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath("crossref-queued.png"), fullPage: true });
});

test("shows the verified Crossref DOI before Zenodo activation", async ({
	page,
}, testInfo) => {
	test.setTimeout(60_000);
	test.skip(phase !== "crossref-settle", "Crossref settlement phase only");
	const inspector = await openPublicationRecord(page);
	const publication = inspector.locator("#admin-doi-publishing");
	const crossref = publication.locator(
		'[data-admin-publication-provider="crossref"]',
	);

	await expect(crossref.getByText("Synced", { exact: true })).toBeVisible();
	await expect(crossref.getByRole("link", { name: expectedDoi })).toBeVisible();
	await expect(
		publication
			.locator('[data-admin-publication-provider="zenodo"]')
			.getByText("Not activated", { exact: true }),
	).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("crossref-synced.png"),
		fullPage: true,
	});
});

test("publishes a metadata edit under the same Crossref DOI", async ({
	page,
}, testInfo) => {
	test.setTimeout(60_000);
	test.skip(phase !== "edit", "Metadata edit phase only");
	test.skip(!editedTitle, "Edited title is not configured");
	const inspector = await openPublicationRecord(page);
	const publication = inspector.locator("#admin-doi-publishing");
	const crossref = publication.locator(
		'[data-admin-publication-provider="crossref"]',
	);

	await expect(crossref.getByText("Synced", { exact: true })).toBeVisible();
	await expect(crossref.getByRole("link", { name: expectedDoi })).toBeVisible();
	await inspector.getByRole("button", { name: "Edit", exact: true }).click();
	await inspector.getByLabel("Title", { exact: true }).fill(editedTitle);
	await expect(inspector.getByText("Saved", { exact: true })).toBeVisible();
	await inspector
		.getByRole("button", { name: "Publish", exact: true })
		.click();

	await expect(
		inspector.getByRole("heading", { name: editedTitle, exact: true }),
	).toBeVisible();
	await expect(
		crossref.getByRole("link", { name: expectedDoi }),
	).toBeVisible();
	await expect(
		crossref.getByText(/Queued|Checking Crossref|Synced/u, { exact: true }),
	).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("crossref-edit-queued.png"),
		fullPage: true,
	});
});

test("shows the edited metadata after Crossref verifies it", async ({
	page,
}, testInfo) => {
	test.setTimeout(60_000);
	test.skip(phase !== "edit-settle", "Metadata settlement phase only");
	test.skip(!editedTitle, "Edited title is not configured");
	const inspector = await openPublicationRecord(page);
	const publication = inspector.locator("#admin-doi-publishing");
	const crossref = publication.locator(
		'[data-admin-publication-provider="crossref"]',
	);

	await expect(crossref.getByText("Synced", { exact: true })).toBeVisible();
	await expect(
		crossref.getByRole("link", { name: expectedDoi }),
	).toBeVisible();
	await expect(
		inspector.getByRole("heading", { name: editedTitle, exact: true }),
	).toBeVisible();

	await page.goto(`/lib/${itemKey}`);
	await dismissConsent(page);
	await expect(
		page.getByRole("heading", { name: editedTitle }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: expectedDoi, exact: true }).first(),
	).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("crossref-edit-synced.png"),
		fullPage: true,
	});
});

test("publishes to Zenodo and keeps both DOI states after reload", async ({
	page,
}, testInfo) => {
	test.setTimeout(120_000);
	test.skip(phase !== "zenodo", "Zenodo phase only");
	let inspector = await openPublicationRecord(page);
	let publication = inspector.locator("#admin-doi-publishing");
	const crossref = publication.locator(
		'[data-admin-publication-provider="crossref"]',
	);
	await expect(crossref.getByText("Synced", { exact: true })).toBeVisible({
		timeout: 90_000,
	});
	await expect(crossref.getByRole("link", { name: expectedDoi })).toBeVisible();

	const zenodo = publication.locator(
		'[data-admin-publication-provider="zenodo"]',
	);
	await zenodo.getByRole("button", { name: "Publish to Zenodo" }).click();
	const dialog = page.getByRole("dialog", { name: "Publish to Zenodo" });
	await expectCompactDialog(page, dialog);
	const reuse = dialog.getByRole("radio", { name: /Use the Crossref DOI/u });
	await expect(reuse).toBeChecked();
	await page.screenshot({ path: testInfo.outputPath("zenodo-dialog.png"), fullPage: true });
	await dialog.getByRole("button", { name: "Publish to Zenodo" }).click();
	await expect(dialog).toBeHidden();
	await expect(zenodo.getByText("Synced", { exact: true })).toBeVisible({
		timeout: 60_000,
	});
	await expect(zenodo.getByRole("link", { name: "Zenodo archive" })).toBeVisible();
	await expect(zenodo.getByText("Uses the Crossref DOI", { exact: true })).toBeVisible();

	await page.reload();
	inspector = await openPublicationRecord(page);
	publication = inspector.locator("#admin-doi-publishing");
	await expect(
		publication
			.locator('[data-admin-publication-provider="crossref"]')
			.getByText("Synced", { exact: true }),
	).toBeVisible();
	await expect(
		publication
			.locator('[data-admin-publication-provider="zenodo"]')
			.getByText("Synced", { exact: true }),
	).toBeVisible();
	await expect(
		publication
			.locator('[data-admin-publication-provider="crossref"]')
			.getByRole("link", { name: expectedDoi }),
	).toBeVisible();
	await expect(
		publication
			.locator('[data-admin-publication-provider="zenodo"]')
			.getByRole("link", { name: "Zenodo archive" }),
	).toBeVisible();
	await expect(
		publication.getByRole("button", { name: /Activate|Publish to Zenodo/u }),
	).toHaveCount(0);

	const publicResponse = await page.request.get(`/api/item/${itemKey}`);
	expect(publicResponse.ok()).toBe(true);
	const publicItem = (await publicResponse.json()).item as {
		publicationIdentifiers?: {
			crossref?: { doi: string; lifecycle: string };
			zenodo?: {
				baseUrl?: string;
				conceptRecordId?: string;
				recordId?: string;
				versionDoi?: string;
			};
		};
	};
	expect(publicItem.publicationIdentifiers).toMatchObject({
		crossref: {
			doi: expectedDoi,
			lifecycle: "verified",
		},
		zenodo: {
			baseUrl: "https://sandbox.zenodo.org",
			versionDoi: expectedDoi,
		},
	});
	const zenodoRecordId = publicItem.publicationIdentifiers?.zenodo?.recordId;
	const zenodoConceptRecordId =
		publicItem.publicationIdentifiers?.zenodo?.conceptRecordId;
	expect(zenodoRecordId).toMatch(/^\d+$/u);
	expect(zenodoConceptRecordId).toMatch(/^\d+$/u);

	await page.goto(`/lib/${itemKey}`);
	await dismissConsent(page);
	await expect(page.getByRole("heading", { name: "Identifiers" })).toBeVisible();
	await expect(page.getByText("Crossref DOI", { exact: true })).toBeVisible();
	await expect(page.getByRole("img", { name: "Crossref" })).toBeVisible();
	await expect(page.getByText("Archive record", { exact: true })).toBeVisible();
	await expect(page.getByText("Concept record", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("link", { name: zenodoRecordId!, exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: zenodoConceptRecordId!, exact: true }),
	).toBeVisible();
	await expect(page.getByRole("img", { name: "Zenodo" })).toHaveCount(2);
	await expect(page.getByRole("img", { name: "DOI" })).toHaveCount(0);
	await page.screenshot({ path: testInfo.outputPath("publication-synced.png"), fullPage: true });
});
