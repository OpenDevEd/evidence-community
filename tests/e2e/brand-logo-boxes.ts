import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The picture shapes a library can upload. The last one carries no width or
 * height at all, which is what an SVG exported from a drawing tool looks like.
 */
export const logoShapes = [
	{ name: "square", ratio: 1, sized: true, viewBox: "0 0 150 150" },
	{ name: "3:1 wide", ratio: 3, sized: true, viewBox: "0 0 300 100" },
	{ name: "1:2 tall", ratio: 0.5, sized: true, viewBox: "0 0 100 200" },
	{ name: "8:1 very wide", ratio: 8, sized: true, viewBox: "0 0 800 100" },
	{ name: "4:1 sizeless", ratio: 4, sized: false, viewBox: "0 0 240 60" },
] as const;

export type LogoShape = (typeof logoShapes)[number];

/**
 * One logo box: how tall its bar draws it, the widest the picture may be, and
 * the box's own width when the box is a fixed square.
 */
export type LogoBox = {
	cap: number;
	fixedWidth?: number;
	height: number;
	place: string;
};

export const logoBoxes = {
	admin: { cap: 144, height: 28, place: "admin" },
	badge: {
		cap: 24,
		fixedWidth: 24,
		height: 24,
		place: "institution-badge",
	},
	cookie: { cap: 144, height: 32, place: "cookie" },
	footer: { cap: 224, height: 48, place: "footer" },
	funder: { cap: 160, height: 48, place: "funder" },
	header: { cap: 192, height: 40, place: "header" },
	phoneHeader: { cap: 192, height: 36, place: "header" },
	row: { cap: 32, fixedWidth: 32, height: 32, place: "institution-row" },
	small: {
		cap: 16,
		fixedWidth: 16,
		height: 16,
		place: "institution-small",
	},
} satisfies Record<string, LogoBox>;

export function logoSvg(shape: LogoShape) {
	const [, , width, height] = shape.viewBox.split(" ");
	const size = shape.sized ? ` width="${width}" height="${height}"` : "";

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${shape.viewBox}"${size}><rect width="${width}" height="${height}" fill="#2563eb"/></svg>`;
}

export function brandAssetUrls() {
	return (
		process.env.PLAYWRIGHT_EXPECTED_BRAND_ASSET_URLS ??
		process.env.PLAYWRIGHT_EXPECTED_LOGO_URLS ??
		"https://assets.example.org/library/logo-light.webp"
	).split("|");
}

export async function serveShape(page: Page, shape: LogoShape) {
	const urls = brandAssetUrls();
	await page.route(
		(url) => urls.includes(url.toString()),
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
 * Checks one logo box against the numbers its bar allows: the box's own height
 * and width, the picture's height and width. Every number is exact, so a box
 * that grows with its picture fails even when the picture still fits inside it.
 */
export async function expectLogoFits(
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
		.toBeCloseTo(box.height, 0);

	const boxRectangle = await rectangleOf(boxLocator, `${label} box`);
	const imageRectangle = await rectangleOf(image, `${label} image`);
	// Padding, and any border a library added itself, take room the picture
	// cannot use. Read it from the page instead of assuming it is zero.
	const inset = await image.evaluate((element) => {
		const style = getComputedStyle(element);
		const total = (...names: string[]) =>
			names.reduce(
				(sum, name) =>
					sum + Number.parseFloat(style.getPropertyValue(name)),
				0,
			);

		return {
			horizontal: total(
				"border-left-width",
				"border-right-width",
				"padding-left",
				"padding-right",
			),
			vertical: total(
				"border-top-width",
				"border-bottom-width",
				"padding-top",
				"padding-bottom",
			),
		};
	});
	const expectedImageWidth = Math.min(
		box.cap,
		(box.height - inset.vertical) * shape.ratio + inset.horizontal,
	);
	const expectedBoxWidth = box.fixedWidth ?? expectedImageWidth;

	console.log(
		`${label}: box ${boxRectangle.width.toFixed(1)}x${boxRectangle.height.toFixed(1)} | image ${imageRectangle.width.toFixed(1)}x${imageRectangle.height.toFixed(1)} | wanted box ${expectedBoxWidth.toFixed(1)}x${box.height} image ${expectedImageWidth.toFixed(1)}x${box.height}`,
	);

	expect(boxRectangle.height).toBeCloseTo(box.height, 0);
	expect(boxRectangle.width).toBeCloseTo(expectedBoxWidth, 0);
	expect(imageRectangle.height).toBeCloseTo(box.height, 0);
	expect(imageRectangle.width).toBeCloseTo(expectedImageWidth, 0);
}

/** The navigation must never sit on top of the logo. */
export async function expectNoOverlapWithNavigation(page: Page) {
	const headerBox = page.locator('[data-brand-logo-box="header"]').first();
	const navigation = page.locator("header nav").first();
	const logoRectangle = await rectangleOf(headerBox, "header logo box");
	const navigationRectangle = await rectangleOf(navigation, "main navigation");

	expect(logoRectangle.x + logoRectangle.width).toBeLessThanOrEqual(
		navigationRectangle.x + 0.5,
	);
}
