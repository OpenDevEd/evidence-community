import { expect, test } from "@playwright/test";

import { dismissConsent } from "./consent";

const editionId = process.env.PLAYWRIGHT_EXPECTED_DIGEST_ID ?? "";
const editionTitle = process.env.PLAYWRIGHT_EXPECTED_DIGEST_TITLE ?? "";

test.skip(!editionId || !editionTitle, "requires a published digest fixture");

for (const view of ["archive", "edition"] as const) {
	test(`${view} recovers when Markdown code arrives after the page shell`, async ({ page }) => {
		const errors: Error[] = [];
		page.on("pageerror", error => errors.push(error));
		let delayedChunks = 0;
		await page.route("**/_next/static/**/*.js", async route => {
			const response = await route.fetch();
			const body = await response.body();
			// Identify Streamdown by its public markup attribute, not a build-specific
			// chunk name. The response stays real; only network delivery is delayed.
			if (body.includes(Buffer.from("data-streamdown"))) {
				delayedChunks++;
				await new Promise(resolve => setTimeout(resolve, 2_000));
			}
			await route.fulfill({ response, body });
		});

		await page.goto(view === "archive" ? "/digests" : `/digests/${editionId}`);
		expect(delayedChunks).toBeGreaterThan(0);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		await dismissConsent(page);
		const archive = page.getByRole("region", { name: "Digest archive", exact: true });
		if (view === "archive") {
			await archive.getByRole("link").filter({ hasText: editionTitle }).click();
		}
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(editionTitle);
		await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
		await page.getByRole("link", { name: "All digests", exact: true }).click();
		await expect(archive.getByRole("heading", { name: editionTitle, exact: true })).toBeVisible();
		expect(errors).toEqual([]);
	});
}
