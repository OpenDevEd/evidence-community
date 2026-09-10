import { expect, test, type Page } from "@playwright/test";
import type { AdminPublicationView } from "../../src/lib/publication/admin-publication-view";
import { openAdmin } from "./admin-login";
import { publishWorkingDraft } from "./admin-review";
import { dismissConsent } from "./consent";

const itemKey = process.env.PLAYWRIGHT_PUBLICATION_ITEM_KEY ?? "";
const expectedDoi = process.env.PLAYWRIGHT_PUBLICATION_EXPECTED_DOI ?? "";
const editedTitle = process.env.PLAYWRIGHT_PUBLICATION_EDITED_TITLE ?? "";
const phase = process.env.PLAYWRIGHT_PUBLICATION_PHASE ?? "";

test.skip(!itemKey || !expectedDoi || !phase, "Publication fixture is not configured");
test.beforeEach(({}, testInfo) => {
    test.skip(!testInfo.title.includes(`[publication:${phase}]`), "Different publication phase");
});

async function readPublication(page: Page): Promise<AdminPublicationView> {
    const response = await page.request.get(`/api/admin/items/${itemKey}/publication`);
    expect(response.ok()).toBe(true);
    return (await response.json()).publication;
}

async function openPublicationRecord(page: Page) {
    await openAdmin(page, `/admin?item=${itemKey}`);
    const inspector = page.locator("#admin-inspector-pane");
    await expect(inspector.getByRole("heading", {name: "Identifiers", exact: true})).toBeVisible();
    return inspector;
}

async function expectCrossrefSynced(page: Page) {
    await expect.poll(async () => (await readPublication(page)).providers.crossref.displayState).toBe("synced");
    const inspector = page.locator("#admin-inspector-pane");
    await expect(inspector.getByText(expectedDoi, {exact: true})).toBeVisible();
    await expect(inspector.getByText("Registered", {exact: true})).toBeVisible();
    return inspector;
}

test("[publication:reserve] reserves internally, then activates both providers through approval", async ({page}, testInfo) => {
    const inspector = await openPublicationRecord(page);
    await inspector.getByRole("button", {name: "Edit", exact: true}).click();
    const registerDoi = inspector.getByRole("switch", {name: "Register a DOI", exact: true});
    await registerDoi.check();
    const route = inspector.getByRole("button", {name: "Crossref + Zenodo", exact: true});
    await route.click();
    await expect(route).toHaveAttribute("aria-pressed", "true");
    await expect(inspector.getByRole("button", {name: "Use Crossref DOI", exact: true})).toHaveAttribute("aria-pressed", "true");
    await inspector.getByRole("button", {name: "Reserve DOI", exact: true}).click();
    await expect(inspector.getByText(expectedDoi, {exact: true})).toBeVisible();
    await expect(inspector.getByText("Reserved", {exact: true})).toBeVisible();
    const reserved = await readPublication(page);
    expect(reserved.providers.crossref.exact.targetActive).toBe(false);
    expect(reserved.providers.zenodo.exact.targetActive).toBe(false);
    await page.screenshot({path: testInfo.outputPath("crossref-reserved.png"), fullPage: true});

    await publishWorkingDraft(page);
    const activated = await readPublication(page);
    expect(activated.providers.crossref.exact.targetActive).toBe(true);
    expect(activated.providers.zenodo.exact.targetActive).toBe(true);
    await inspector.getByRole("button", {name: "Submitted version", exact: true}).click();
    await expect(inspector.getByText("Register Crossref DOI", {exact: true})).toBeVisible();
    await expect(inspector.getByText("Archive files on Zenodo", {exact: true})).toBeVisible();
    await page.screenshot({path: testInfo.outputPath("publication-approved.png"), fullPage: true});
});

test("[publication:crossref-settle] shows the verified DOI with mandatory archiving active", async ({page}, testInfo) => {
    test.setTimeout(60_000);
    await openPublicationRecord(page);
    await expectCrossrefSynced(page);
    expect((await readPublication(page)).providers.zenodo.exact.targetActive).toBe(true);
    await page.screenshot({path: testInfo.outputPath("crossref-synced.png"), fullPage: true});
});

test("[publication:edit] keeps edits private until an editor publishes their snapshot", async ({page}, testInfo) => {
    test.setTimeout(60_000);
    test.skip(!editedTitle, "Edited title is not configured");
    const inspector = await openPublicationRecord(page);
    await expectCrossrefSynced(page);
    await inspector.getByRole("button", {name: "Edit", exact: true}).click();
    await inspector.getByLabel("Title", {exact: true}).fill(editedTitle);
    await expect(inspector.getByText("Saved", {exact: true})).toBeVisible();
    const beforeApproval = await page.request.get(`/api/item/${itemKey}`);
    expect((await beforeApproval.json()).item.title).not.toBe(editedTitle);
    await publishWorkingDraft(page);
    await expect(inspector.getByRole("heading", {name: editedTitle, exact: true})).toBeVisible();
    await expect(inspector.getByText(expectedDoi, {exact: true})).toBeVisible();
    await page.screenshot({path: testInfo.outputPath("crossref-edit-approved.png"), fullPage: true});
});

test("[publication:edit-settle] shows approved metadata after Crossref verifies it", async ({page}, testInfo) => {
    test.setTimeout(60_000);
    test.skip(!editedTitle, "Edited title is not configured");
    await openPublicationRecord(page);
    await expectCrossrefSynced(page);
    await page.goto(`/lib/${itemKey}`);
    await dismissConsent(page);
    await expect(page.getByRole("heading", {name: editedTitle})).toBeVisible();
    await expect(page.getByRole("link", {name: expectedDoi, exact: true}).first()).toBeVisible();
    await page.screenshot({path: testInfo.outputPath("crossref-edit-synced.png"), fullPage: true});
});

test("[publication:zenodo] archives automatically and retains both providers after reload", async ({page}, testInfo) => {
    test.setTimeout(120_000);
    let inspector = await openPublicationRecord(page);
    await expectCrossrefSynced(page);
    await expect.poll(async () => (await readPublication(page)).providers.zenodo.displayState, {timeout: 90_000}).toBe("synced");
    await page.reload();
    inspector = await openPublicationRecord(page);
    await expectCrossrefSynced(page);
    await inspector.getByRole("button", {name: "Submitted version", exact: true}).click();
    await expect(inspector.getByText("Submitted version published. Later draft edits stay private.", {exact: true})).toBeVisible();
	await expect
		.poll(
			async () => {
				const response = await page.request.get(`/api/item/${itemKey}`);
				if (!response.ok()) return null;
				return (await response.json()).item?.publicationIdentifiers;
			},
			{
				message: "the public search projection to include the Zenodo record",
				timeout: 60_000,
			},
		)
		.toMatchObject({
			crossref: {
				doi: expectedDoi,
				lifecycle: "verified",
			},
			zenodo: {
				baseUrl: "https://sandbox.zenodo.org",
				versionDoi: expectedDoi,
			},
		});
	const publicResponse = await page.request.get(`/api/item/${itemKey}`);
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
