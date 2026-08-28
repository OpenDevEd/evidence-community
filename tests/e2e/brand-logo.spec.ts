import { expect, test, type Locator, type Page } from "@playwright/test";

const logoUrls = (
	process.env.PLAYWRIGHT_EXPECTED_LOGO_URLS ??
	"https://assets.example.org/library/logo-light.webp"
).split("|");
const consentDecline =
	process.env.PLAYWRIGHT_EXPECTED_CONSENT_DECLINE ?? "Decline";

const rootFontSize = 16;

/**
 * The three logo shapes an owner can upload. Each one is drawn at its own
 * pixel size, which is exactly what used to push the bars open.
 */
const logoShapes = [
	{ name: "square", width: 150, height: 150 },
	{ name: "3:1 landscape", width: 300, height: 100 },
	{ name: "1:2 portrait", width: 100, height: 200 },
];

function logoImage(width: number, height: number) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#2563eb"/></svg>`;
}

async function serveLogoShape(page: Page, width: number, height: number) {
	await page.route(
		(url) => logoUrls.includes(url.toString()),
		(route) =>
			route.fulfill({
				body: logoImage(width, height),
				contentType: "image/svg+xml",
			}),
	);
}

async function dropOwnerLogoCss(page: Page) {
	// The owner's own logo CSS is a deliberate override that can set any size.
	// Switch it off so the measurement reads the sizing the runtime ships.
	await page.evaluate(() => {
		const ownerStyles = document.getElementById("library-logo-styles");
		if (ownerStyles instanceof HTMLStyleElement) {
			ownerStyles.disabled = true;
		}
	});
}

async function measure(locator: Locator, what: string) {
	const rectangle = await locator.boundingBox();
	expect(rectangle, `${what} must be on the page`).not.toBeNull();
	return rectangle!;
}

async function expectLogoFits(
	place: string,
	box: Locator,
	bar: Locator,
	capRem: number,
) {
	const image = box.locator("img[data-library-logo]:visible").first();
	await expect
		.poll(() =>
			image.evaluate((element: HTMLImageElement) =>
				element.complete ? element.naturalWidth : 0,
			),
		)
		.toBeGreaterThan(0);

	const imageRectangle = await measure(image, `${place} logo`);
	const boxRectangle = await measure(box, `${place} logo box`);
	const barRectangle = await measure(bar, `${place} bar`);
	const capPixels = capRem * rootFontSize;

	console.log(
		`${place}: image ${imageRectangle.width.toFixed(1)}x${imageRectangle.height.toFixed(1)} | box ${boxRectangle.width.toFixed(1)}x${boxRectangle.height.toFixed(1)} | bar height ${barRectangle.height.toFixed(1)} | cap ${capPixels}`,
	);

	expect(imageRectangle.height).toBeLessThanOrEqual(
		boxRectangle.height + 0.5,
	);
	expect(imageRectangle.width).toBeLessThanOrEqual(capPixels + 0.5);
	expect(imageRectangle.y).toBeGreaterThanOrEqual(barRectangle.y - 0.5);
	expect(imageRectangle.y + imageRectangle.height).toBeLessThanOrEqual(
		barRectangle.y + barRectangle.height + 0.5,
	);
}

for (const shape of logoShapes) {
	test(`keeps a ${shape.name} logo inside the header, footer and cookie dialog`, async ({
		page,
	}) => {
		await serveLogoShape(page, shape.width, shape.height);
		await page.goto("/lib");
		await dropOwnerLogoCss(page);

		const cookieBox = page.locator('[data-brand-logo-box="cookie"]');
		await expect(cookieBox).toBeVisible();
		await expectLogoFits(
			`${shape.name} cookie dialog`,
			cookieBox,
			page.getByRole("dialog").first(),
			9,
		);

		await page
			.getByRole("button", { name: consentDecline, exact: true })
			.click();
		await expect(cookieBox).toBeHidden();

		const headerBox = page.locator('[data-brand-logo-box="header"]');
		await expectLogoFits(
			`${shape.name} header`,
			headerBox,
			page.locator("header").filter({ has: headerBox }).first(),
			12,
		);

		const footerBox = page.locator('[data-brand-logo-box="footer"]');
		await footerBox.scrollIntoViewIfNeeded();
		await expectLogoFits(
			`${shape.name} footer`,
			footerBox,
			page.locator("footer").filter({ has: footerBox }).first(),
			14,
		);
	});
}
