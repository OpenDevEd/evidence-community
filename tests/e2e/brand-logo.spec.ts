import { expect, test, type Page } from "@playwright/test";

import {
	brandAssetUrls,
	expectLogoFits,
	expectNoOverlapWithNavigation,
	logoBoxes,
	logoShapes,
	logoSvg,
	serveShape,
	type LogoShape,
} from "./brand-logo-boxes";

const consentDecline =
	process.env.PLAYWRIGHT_EXPECTED_CONSENT_DECLINE ?? "Decline";
const recordKey =
	process.env.PLAYWRIGHT_EXPECTED_SEARCH_ITEM_KEY ?? "AMBER_SEARCH_FIXTURE";
const hasNavbarSearch = process.env.PLAYWRIGHT_EXPECTED_NAVBAR_SEARCH !== "false";
const headerReservation = 192;

async function declineCookies(page: Page) {
	await page
		.getByRole("button", { name: consentDecline, exact: true })
		.click();
	await expect(page.locator('[data-brand-logo-box="cookie"]')).toHaveCount(0);
}

async function measureLibraryPage(page: Page, shape: LogoShape, prefix: string) {
	await expectLogoFits(
		page,
		logoBoxes.cookie,
		shape,
		`${prefix}cookie dialog`,
	);
	await declineCookies(page);

	await expectLogoFits(
		page,
		prefix ? logoBoxes.phoneHeader : logoBoxes.header,
		shape,
		`${prefix}header`,
	);
	await expectNoOverlapWithNavigation(page);

	await page
		.locator('[data-brand-logo-box="footer"]')
		.first()
		.scrollIntoViewIfNeeded();
	await expectLogoFits(page, logoBoxes.footer, shape, `${prefix}footer`);
	await expectLogoFits(page, logoBoxes.funder, shape, `${prefix}funder`);
}

async function measureListingInstitution(page: Page, shape: LogoShape) {
	const badge = page
		.locator('[data-brand-logo-box="institution-badge"]')
		.first();
	await badge.scrollIntoViewIfNeeded();
	await expectLogoFits(page, logoBoxes.badge, shape, "listing institution");
}

async function measureRecordPage(page: Page, shape: LogoShape, prefix: string) {
	await page.goto(`/lib/${recordKey}`);
	await expectLogoFits(
		page,
		logoBoxes.row,
		shape,
		`${prefix}record institution`,
	);

	if (!hasNavbarSearch) return;

	// Opening the navbar search lists records, each with the small mark.
	await page.locator('[role="search"] input').first().click();
	await expectLogoFits(
		page,
		logoBoxes.small,
		shape,
		`${prefix}suggestion institution`,
	);
}

for (const shape of logoShapes) {
	test(`fits a ${shape.name} logo into every bar`, async ({ page }) => {
		await serveShape(page, shape);
		await page.goto("/lib");

		await measureLibraryPage(page, shape, "");
		await measureListingInstitution(page, shape);
		await measureRecordPage(page, shape, "");
	});
}

test.describe("on a phone", () => {
	test.use({ viewport: { width: 390, height: 844 } });

	for (const shape of logoShapes) {
		test(`fits a ${shape.name} logo into every bar`, async ({ page }) => {
			await serveShape(page, shape);
			await page.goto("/lib");

			await measureLibraryPage(page, shape, "phone ");
			await measureRecordPage(page, shape, "phone ");
		});
	}
});

test("holds the widest a logo may be until the logo people see arrives", async ({
	page,
}) => {
	const shape = logoShapes[0];
	const visibleUrl =
		process.env.PLAYWRIGHT_EXPECTED_LOGO_URL ?? brandAssetUrls()[0];
	const hiddenUrl =
		brandAssetUrls().find((url) => url !== visibleUrl) ?? visibleUrl;

	const gates = new Map<string, () => void>();
	const held = new Map<string, Promise<void>>();
	for (const url of new Set([visibleUrl, hiddenUrl])) {
		held.set(
			url,
			new Promise<void>((resolve) => gates.set(url, resolve)),
		);
	}

	await page.route(
		(url) => held.has(url.toString()),
		async (route) => {
			await held.get(route.request().url());
			await route.fulfill({
				body: logoSvg(shape),
				contentType: "image/svg+xml",
			});
		},
	);
	await page.goto("/lib", { waitUntil: "domcontentloaded" });
	await declineCookies(page);

	const slot = page.locator('[data-brand-logo-box="header"]').first();
	await slot.waitFor({ state: "attached" });
	const slotWidth = () =>
		slot.evaluate((element) => element.getBoundingClientRect().width);

	await expect.poll(slotWidth).toBeCloseTo(headerReservation, 0);

	// The logo for the other colour scheme is never on screen. Its arrival
	// must not make the header give up the room it is holding.
	if (hiddenUrl !== visibleUrl) {
		gates.get(hiddenUrl)!();
		await expect
			.poll(() =>
				page
					.locator(`img[src="${hiddenUrl}"]`)
					.first()
					.evaluate((element: HTMLImageElement) =>
						element.complete ? element.naturalWidth || 1 : 0,
					),
			)
			.toBeGreaterThan(0);
		await expect.poll(slotWidth).toBeCloseTo(headerReservation, 0);
	}

	gates.get(visibleUrl)!();
	await expectLogoFits(page, logoBoxes.header, shape, "loaded header");

	// Once the picture is there the box is only as wide as the logo itself.
	await expect.poll(slotWidth).toBeCloseTo(logoBoxes.header.height, 0);
});

test.describe("on a narrow screen", () => {
	// Narrow enough that a logo at its full 12rem cap cannot fit beside
	// anything else, so the header has to make it give way.
	test.use({ viewport: { width: 240, height: 720 } });

	test("shrinks the logo rather than pushing the header open", async ({
		page,
	}) => {
		const shape = logoShapes[3];
		await serveShape(page, shape);
		await page.goto("/lib");
		await declineCookies(page);

		const box = page.locator('[data-brand-logo-box="header"]').first();
		const image = box.locator("img:visible");
		await expect
			.poll(() =>
				image.evaluate((element: HTMLImageElement) =>
					element.complete ? element.naturalWidth || 1 : 0,
				),
			)
			.toBeGreaterThan(0);

		const boxRectangle = await box.evaluate((element: HTMLElement) => ({
			height: element.offsetHeight,
			width: element.offsetWidth,
		}));
		const imageRectangle = await image.evaluate(
			(element: HTMLElement) => ({
				height: element.offsetHeight,
				width: element.offsetWidth,
			}),
		);
		const bar = page.locator("header").filter({ has: box }).first();
		const overflow = await bar.evaluate((element) => {
			const row = element.firstElementChild ?? element;
			return row.scrollWidth - row.clientWidth;
		});

		console.log(
			`narrow header: box ${boxRectangle.width.toFixed(1)}x${boxRectangle.height.toFixed(1)} | image ${imageRectangle.width.toFixed(1)}x${imageRectangle.height.toFixed(1)} | row overflow ${overflow}`,
		);

		// The bar keeps its height and its row still fits on the screen.
		expect(boxRectangle.height).toBeCloseTo(logoBoxes.phoneHeader.height, 0);
		expect(imageRectangle.height).toBeCloseTo(
			logoBoxes.phoneHeader.height,
			0,
		);
		expect(overflow).toBeLessThanOrEqual(1);
		// A very wide logo gives way instead of taking the whole bar, but it
		// is still drawn: giving way must not squeeze it to nothing.
		expect(boxRectangle.width).toBeLessThan(logoBoxes.header.cap);
		expect(boxRectangle.width).toBeGreaterThanOrEqual(
			logoBoxes.phoneHeader.height,
		);
		expect(imageRectangle.width).toBeGreaterThanOrEqual(
			logoBoxes.phoneHeader.height,
		);
		await expectNoOverlapWithNavigation(page);
	});
});
