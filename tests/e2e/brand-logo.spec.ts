import { expect, test, type Locator, type Page } from "@playwright/test";

const brandAssetUrls = (
	process.env.PLAYWRIGHT_EXPECTED_BRAND_ASSET_URLS ??
	process.env.PLAYWRIGHT_EXPECTED_LOGO_URLS ??
	"https://assets.example.org/library/logo-light.webp"
).split("|");
const consentDecline =
	process.env.PLAYWRIGHT_EXPECTED_CONSENT_DECLINE ?? "Decline";
const recordKey =
	process.env.PLAYWRIGHT_EXPECTED_SEARCH_ITEM_KEY ?? "AMBER_SEARCH_FIXTURE";

/**
 * The picture shapes a library can upload. The last one carries no width or
 * height at all, which is what an SVG exported from a drawing tool usually
 * looks like.
 */
const logoShapes = [
	{ name: "square", ratio: 1, sized: true, viewBox: "0 0 150 150" },
	{ name: "3:1 wide", ratio: 3, sized: true, viewBox: "0 0 300 100" },
	{ name: "1:2 tall", ratio: 0.5, sized: true, viewBox: "0 0 100 200" },
	{ name: "8:1 very wide", ratio: 8, sized: true, viewBox: "0 0 800 100" },
	{ name: "4:1 sizeless", ratio: 4, sized: false, viewBox: "0 0 240 60" },
] as const;

type LogoShape = (typeof logoShapes)[number];

/**
 * Every logo box on the page, the height its bar allows, the height its image
 * fills inside that box, and the widest the image may ever be.
 */
type LogoBox = {
	boxHeight: number;
	cap: number;
	exactWidth: boolean;
	imageHeight: number;
	place: string;
};

const desktopBoxes = {
	cookie: {
		boxHeight: 32,
		cap: 144,
		exactWidth: true,
		imageHeight: 32,
		place: "cookie",
	},
	footer: {
		boxHeight: 48,
		cap: 224,
		exactWidth: true,
		imageHeight: 48,
		place: "footer",
	},
	funder: {
		boxHeight: 48,
		cap: 160,
		exactWidth: false,
		imageHeight: 40,
		place: "funder",
	},
	header: {
		boxHeight: 40,
		cap: 192,
		exactWidth: true,
		imageHeight: 40,
		place: "header",
	},
	institution: {
		boxHeight: 32,
		cap: 32,
		exactWidth: false,
		imageHeight: 32,
		place: "institution",
	},
} satisfies Record<string, LogoBox>;

const mobileHeader = { ...desktopBoxes.header, boxHeight: 36, imageHeight: 36 };

function logoSvg(shape: LogoShape) {
	const [, , width, height] = shape.viewBox.split(" ");
	const size = shape.sized ? ` width="${width}" height="${height}"` : "";

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${shape.viewBox}"${size}><rect width="${width}" height="${height}" fill="#2563eb"/></svg>`;
}

async function serveShape(page: Page, shape: LogoShape) {
	await page.route(
		(url) => brandAssetUrls.includes(url.toString()),
		(route) =>
			route.fulfill({
				body: logoSvg(shape),
				contentType: "image/svg+xml",
			}),
	);
}

async function rectangleOf(locator: Locator, what: string) {
	const rectangle = await locator.boundingBox();
	expect(rectangle, `${what} must be on the page`).not.toBeNull();
	return rectangle!;
}

/**
 * Checks one logo box: the bar's height, the image inside it, and the width
 * cap. The numbers are exact, so a box that grows with its picture fails even
 * when the picture still fits inside it.
 */
async function expectLogoFits(
	page: Page,
	box: LogoBox,
	shape: LogoShape,
	label: string,
) {
	const boxLocator = page
		.locator(`[data-brand-logo-box="${box.place}"]`)
		.first();
	const image = boxLocator.locator("img:visible");

	// A library ships a light and a dark logo. Exactly one is ever on screen.
	await expect(image).toHaveCount(1);
	await expect
		.poll(() =>
			image.evaluate((element: HTMLImageElement) =>
				element.complete ? element.naturalWidth || 1 : 0,
			),
		)
		.toBeGreaterThan(0);
	// A dialog fades and scales in. Wait for the box to settle before reading it.
	await expect
		.poll(async () => (await boxLocator.boundingBox())?.height ?? 0)
		.toBeCloseTo(box.boxHeight, 0);

	const boxRectangle = await rectangleOf(boxLocator, `${label} box`);
	const imageRectangle = await rectangleOf(image, `${label} image`);
	const expectedWidth = Math.min(box.cap, box.imageHeight * shape.ratio);

	console.log(
		`${label}: box ${boxRectangle.width.toFixed(1)}x${boxRectangle.height.toFixed(1)} | image ${imageRectangle.width.toFixed(1)}x${imageRectangle.height.toFixed(1)} | expected height ${box.boxHeight} | cap ${box.cap}`,
	);

	expect(boxRectangle.height).toBeCloseTo(box.boxHeight, 0);
	expect(imageRectangle.height).toBeCloseTo(box.imageHeight, 0);
	expect(boxRectangle.width).toBeLessThanOrEqual(box.cap + 0.5);
	expect(imageRectangle.width).toBeLessThanOrEqual(box.cap + 0.5);

	if (box.exactWidth) {
		expect(imageRectangle.width).toBeCloseTo(expectedWidth, 0);
	}
}

async function declineCookies(page: Page) {
	await page
		.getByRole("button", { name: consentDecline, exact: true })
		.click();
	await expect(
		page.locator('[data-brand-logo-box="cookie"]'),
	).toHaveCount(0);
}

/** The navigation must never sit on top of the logo. */
async function expectNoOverlapWithNavigation(page: Page) {
	const headerBox = page.locator('[data-brand-logo-box="header"]').first();
	const navigation = page.locator("header nav").first();
	const logoRectangle = await rectangleOf(headerBox, "header logo box");
	const navigationRectangle = await rectangleOf(navigation, "main navigation");

	expect(logoRectangle.x + logoRectangle.width).toBeLessThanOrEqual(
		navigationRectangle.x + 0.5,
	);
}

for (const shape of logoShapes) {
	test(`fits a ${shape.name} logo into every bar`, async ({ page }) => {
		await serveShape(page, shape);
		await page.goto("/lib");

		await expectLogoFits(
			page,
			desktopBoxes.cookie,
			shape,
			`${shape.name} cookie dialog`,
		);
		await declineCookies(page);

		await expectLogoFits(
			page,
			desktopBoxes.header,
			shape,
			`${shape.name} header`,
		);
		await expectNoOverlapWithNavigation(page);

		await page
			.locator('[data-brand-logo-box="footer"]')
			.first()
			.scrollIntoViewIfNeeded();
		await expectLogoFits(
			page,
			desktopBoxes.footer,
			shape,
			`${shape.name} footer`,
		);
		await expectLogoFits(
			page,
			desktopBoxes.funder,
			shape,
			`${shape.name} funder`,
		);

		await page.goto(`/lib/${recordKey}`);
		await expectLogoFits(
			page,
			desktopBoxes.institution,
			shape,
			`${shape.name} record institution`,
		);
	});
}

test.describe("on a phone", () => {
	test.use({ viewport: { width: 390, height: 844 } });

	for (const shape of logoShapes) {
		test(`fits a ${shape.name} logo into every bar`, async ({ page }) => {
			await serveShape(page, shape);
			await page.goto("/lib");

			await expectLogoFits(
				page,
				desktopBoxes.cookie,
				shape,
				`phone ${shape.name} cookie dialog`,
			);
			await declineCookies(page);

			await expectLogoFits(
				page,
				mobileHeader,
				shape,
				`phone ${shape.name} header`,
			);

			await page
				.locator('[data-brand-logo-box="footer"]')
				.first()
				.scrollIntoViewIfNeeded();
			await expectLogoFits(
				page,
				desktopBoxes.footer,
				shape,
				`phone ${shape.name} footer`,
			);
			await expectLogoFits(
				page,
				desktopBoxes.funder,
				shape,
				`phone ${shape.name} funder`,
			);
		});
	}
});
