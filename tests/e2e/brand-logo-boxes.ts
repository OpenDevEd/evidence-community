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
type LogoBox = {
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
/**
 * Waits for every animation on the page that has an end. A shimmer that runs
 * for ever is left alone, or this would never return.
 */
async function waitForAnimations(page: Page) {
	await page.evaluate(async () => {
		const running = document
			.getAnimations()
			.filter(
				(animation) =>
					animation.effect?.getComputedTiming().iterations !==
					Number.POSITIVE_INFINITY,
			);

		await Promise.race([
			Promise.all(
				running.map((animation) =>
					animation.finished.catch(() => undefined),
				),
			),
			new Promise((resolve) => setTimeout(resolve, 3_000)),
		]);
	});
}

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
	// A dialog scales as it opens, so anything read from the screen keeps
	// changing while it moves. Let the page settle before reading anything.
	await waitForAnimations(page);
	// Some of that movement is driven by JavaScript frame by frame, which the
	// browser's own animation list does not know about. Wait until the box is
	// drawn at the size its own layout says it is.
	await expect
		.poll(
			() =>
				boxLocator.evaluate((element: HTMLElement) =>
					element.offsetHeight === 0
						? 0
						: element.getBoundingClientRect().height /
							element.offsetHeight,
				),
			{ timeout: 15_000 },
		)
		.toBeCloseTo(1, 2);

	// The layout box is the size CSS gave the logo. The drawn box is what a
	// visitor sees. Both are checked: the layout box catches a wrong rule, the
	// drawn box catches a stretch or a shrink applied somewhere above it. Both
	// are read in one go, because a dialog slides as it opens and two separate
	// readings would come from two different moments.
	const measured = await boxLocator.evaluate((element: HTMLElement) => {
		const picture = Array.from(element.querySelectorAll("img")).find(
			(candidate) => getComputedStyle(candidate).display !== "none",
		);
		if (!picture) return null;

		const style = getComputedStyle(picture);
		const total = (...names: string[]) =>
			names.reduce(
				(sum, name) =>
					sum + Number.parseFloat(style.getPropertyValue(name)),
				0,
			);
		const drawnRectangle = (target: Element) => {
			const rectangle = target.getBoundingClientRect();
			return {
				height: rectangle.height,
				width: rectangle.width,
				x: rectangle.x,
				y: rectangle.y,
			};
		};

		return {
			drawnBox: drawnRectangle(element),
			drawnImage: drawnRectangle(picture),
			// Padding, and any border a library added itself, take room the
			// picture cannot use.
			inset: {
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
			},
			layoutBox: {
				height: element.offsetHeight,
				width: element.offsetWidth,
			},
			layoutImage: {
				height: picture.offsetHeight,
				width: picture.offsetWidth,
			},
		};
	});
	expect(measured, `${label} must be on the page`).not.toBeNull();

	const {
		drawnBox,
		drawnImage,
		inset,
		layoutBox: boxRectangle,
		layoutImage: imageRectangle,
	} = measured!;
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

	expect(drawnBox.height).toBeCloseTo(box.height, 0);
	expect(drawnBox.width).toBeCloseTo(expectedBoxWidth, 0);
	expect(drawnImage.height).toBeCloseTo(box.height, 0);
	expect(drawnImage.width).toBeCloseTo(expectedImageWidth, 0);

	// And it sits inside its own box, not over the edge of it.
	expect(drawnImage.x).toBeGreaterThanOrEqual(drawnBox.x - 0.5);
	expect(drawnImage.y).toBeGreaterThanOrEqual(drawnBox.y - 0.5);
	expect(drawnImage.x + drawnImage.width).toBeLessThanOrEqual(
		drawnBox.x + drawnBox.width + 0.5,
	);
	expect(drawnImage.y + drawnImage.height).toBeLessThanOrEqual(
		drawnBox.y + drawnBox.height + 0.5,
	);
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
