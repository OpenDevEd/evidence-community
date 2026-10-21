import { expectsConsent } from "./consent";
import { expect, test, type Page } from "@playwright/test";

import {
	brandAssetUrls,
	expectLogoFits,
	expectNoOverlapWithNavigation,
	logoBoxes,
	logoShapes,
	logoSvg,
	logoThemeOf,
	requestsFile,
	serveShape,
	type LogoShape,
} from "./brand-logo-boxes";

const consentDecline =
	process.env.PLAYWRIGHT_EXPECTED_CONSENT_DECLINE ?? "Decline";
const recordKey =
	process.env.PLAYWRIGHT_EXPECTED_SEARCH_ITEM_KEY ?? "AMBR3456";
const hasNavbarSearch = process.env.PLAYWRIGHT_EXPECTED_NAVBAR_SEARCH !== "false";
const hasThemeSwitcher =
	process.env.PLAYWRIGHT_EXPECTED_THEME_SWITCHER !== "false";

async function declineCookies(page: Page) {
	if (!expectsConsent) return;
	await page
		.getByRole("button", { name: consentDecline, exact: true })
		.click();
	await expect(page.locator('[data-brand-logo-box="cookie"]')).toHaveCount(0);
}

async function measureLibraryPage(page: Page, shape: LogoShape, prefix: string) {
	if (expectsConsent) {
		await expectLogoFits(
			page,
			logoBoxes.cookie,
			shape,
			`${prefix}cookie dialog`,
		);
	}
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

test("holds the logo's own width until the logo people see arrives", async ({
	page,
}) => {
	await waitForLogoMeasurement(page);
	const { hiddenUrl, release, routed, visibleUrl } = holdLogoFiles(page);

	await routed;
	await page.goto("/lib", { waitUntil: "domcontentloaded" });
	await declineCookies(page);

	const slot = page.locator('[data-brand-logo-box="header"]').first();
	await slot.waitFor({ state: "attached" });
	const slotWidth = () =>
		slot.evaluate((element) => element.getBoundingClientRect().width);

	// The server measured the library's logos, so before any picture arrives
	// the box is already as wide as the logo will be.
	const held = await slotWidth();
	expect(held).toBeGreaterThan(0);

	// The logo for the other colour scheme is never on screen. Its arrival
	// must not make the header give up the room it is holding.
	if (hiddenUrl !== visibleUrl) {
		release(hiddenUrl);
		// The hidden logo is the other scheme's picture, requested directly or through the optimizer.
		const hiddenTheme = logoThemeOf(hiddenUrl);
		await expect
			.poll(() =>
				page.evaluate(
					({ url, theme }) => {
						const image = [...document.querySelectorAll("img")].find((element) => {
							const source = element.getAttribute("src") ?? "";
							return source === url || (theme !== undefined && decodeURIComponent(source).includes(`/logo-${theme}.`));
						});
						return image?.complete ? image.naturalWidth || 1 : 0;
					},
					{ url: hiddenUrl, theme: hiddenTheme },
				),
			)
			.toBeGreaterThan(0);
		await expect.poll(slotWidth).toBeCloseTo(held, 0);
	}

	// Once the picture is there the box is only as wide as the logo itself,
	// which is the width it held.
	release(visibleUrl);
	expect(await loadedHeaderWidth(page)).toBeCloseTo(held, 0);
});

/**
 * The first page a server draws can come before it has measured the logos and
 * the font. The loading tests are about the measured header, so they wait for it.
 */
async function waitForLogoMeasurement(page: Page) {
	await expect
		.poll(async () => (await page.request.get("/lib")).text())
		.not.toContain('data-navbar-fit="fallback"');
}

/**
 * Holds each logo file until the test lets it through, then lets the real file
 * through: the server measured the real files, so the header is sized for them.
 */
function holdLogoFiles(page: Page) {
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

	const heldFor = (url: URL) => [...held.keys()].find((configured) => requestsFile(url, configured));
	const route = page.route(
		(url) => heldFor(url) !== undefined,
		async (handler) => {
			await held.get(heldFor(new URL(handler.request().url()))!);
			await handler.continue();
		},
	);

	return {
		hiddenUrl,
		release: (url: string) => gates.get(url)?.(),
		routed: route,
		visibleUrl,
	};
}

/** Waits for the header's picture on screen to arrive, and gives the width it is drawn at, which the box then has. */
async function loadedHeaderWidth(page: Page) {
	const image = page
		.locator('[data-brand-logo-box="header"]')
		.first()
		.locator("img:visible");
	await expect
		.poll(() =>
			image.evaluate((element: HTMLImageElement) =>
				element.complete ? element.naturalWidth : 0,
			),
		)
		.toBeGreaterThan(0);
	const drawn = await image.evaluate(
		(element) => element.getBoundingClientRect().width,
	);
	await expect.poll(() => headerBoxWidth(page)).toBeCloseTo(drawn, 0);
	return drawn;
}

function headerBoxWidth(page: Page) {
	return page
		.locator('[data-brand-logo-box="header"]')
		.first()
		.evaluate((element) => element.getBoundingClientRect().width);
}

/** Turns the page from light to dark or back, and waits for the change. */
async function switchColourScheme(page: Page) {
	const chosen = await page.evaluate(() => {
		const next = document.documentElement.classList.contains("dark")
			? "light"
			: "dark";
		localStorage.setItem("theme", next);
		window.dispatchEvent(
			new StorageEvent("storage", { key: "theme", newValue: next }),
		);
		return next;
	});

	await expect
		.poll(() =>
			page.evaluate(() =>
				document.documentElement.classList.contains("dark"),
			),
		)
		.toBe(chosen === "dark");
}

/**
 * Reads the header logo box straight away and then on every frame the browser
 * draws, so a width that appears for a single frame cannot slip past.
 *
 * The first reading is taken there and then rather than on the next frame, so
 * the count of readings is one more than the number of frames waited for.
 */
async function startWatchingHeaderBox(page: Page) {
	await page.evaluate(() => {
		const box = document.querySelector('[data-brand-logo-box="header"]');
		if (!box) throw new Error("The header logo box is not on the page");

		const read = () => box.getBoundingClientRect().width;
		const widths: number[] = [read()];
		let watching = true;
		const readFrame = () => {
			widths.push(read());
			if (watching) requestAnimationFrame(readFrame);
		};

		Object.assign(window, {
			__headerBoxWidths: widths,
			__stopHeaderBoxWatch: () => {
				watching = false;
			},
		});
		requestAnimationFrame(readFrame);
	});
}

async function stopWatchingHeaderBox(page: Page) {
	return page.evaluate(() => {
		const scope = window as typeof window & {
			__headerBoxWidths?: number[];
			__stopHeaderBoxWatch?: () => void;
		};
		scope.__stopHeaderBoxWatch?.();

		return scope.__headerBoxWidths ?? [];
	});
}

/** How many frames to let the browser draw after each colour-scheme switch. */
const SETTLE_FRAMES = 5;

/** Lets the browser draw a few more frames, without waiting on the clock. */
async function settleFrames(page: Page, frames = SETTLE_FRAMES) {
	await page.evaluate(
		(count) =>
			new Promise<void>((resolve) => {
				let left = count;
				const step = () => {
					left -= 1;
					if (left <= 0) resolve();
					else requestAnimationFrame(step);
				};
				requestAnimationFrame(step);
			}),
		frames,
	);
}

test("holds the room once for each logo and never again", async ({ page }) => {
	const files = holdLogoFiles(page);
	test.skip(
		!hasThemeSwitcher || files.hiddenUrl === files.visibleUrl,
		"This library cannot switch between light and dark logos",
	);

	await waitForLogoMeasurement(page);
	await files.routed;
	await page.goto("/lib", { waitUntil: "domcontentloaded" });
	await declineCookies(page);

	files.release(files.visibleUrl);
	const first = await loadedHeaderWidth(page);

	// The other colour scheme's picture has not arrived, so the header holds
	// room for the wider of the two logos rather than jumping when it lands.
	await switchColourScheme(page);
	const held = await headerBoxWidth(page);

	files.release(files.hiddenUrl);
	const second = await loadedHeaderWidth(page);
	const wider = Math.max(first, second);
	expect(held).toBeCloseTo(wider, 0);

	// Both pictures are here now. Switching either way must never put the
	// held room back, in any frame the browser draws.
	await startWatchingHeaderBox(page);
	await switchColourScheme(page);
	await settleFrames(page);
	await switchColourScheme(page);
	await settleFrames(page);

	const widths = await stopWatchingHeaderBox(page);
	// One reading when the watch starts, then one for every frame waited for
	// after each of the two switches. Anything fewer means the watch stopped
	// reading and the result would prove nothing.
	const guaranteedReadings = 1 + SETTLE_FRAMES * 2;
	console.log(
		`across both switches: ${widths.length} readings, widest header box ${Math.max(...widths)}`,
	);

	expect(widths.length).toBeGreaterThanOrEqual(guaranteedReadings);
	expect(Math.max(...widths)).toBeCloseTo(wider, 0);
});

test("keeps a huge shadow and blur inside the logo box", async ({ page }) => {
	const shape = logoShapes[0];
	await serveShape(page, shape);
	await page.goto("/lib");
	await declineCookies(page);

	const box = page.locator('[data-brand-logo-box="header"]').first();
	await expect
		.poll(() =>
			box
				.locator("img:visible")
				.evaluate((element: HTMLImageElement) =>
					element.complete ? element.naturalWidth || 1 : 0,
				),
		)
		.toBeGreaterThan(0);

	// A strip of the bar just above the logo. Nothing is drawn there.
	const logo = (await box.boundingBox())!;
	const strip = {
		height: 10,
		width: Math.round(logo.width) + 16,
		x: Math.round(logo.x) - 8,
		y: Math.round(logo.y) - 14,
	};
	const shot = () =>
		page.screenshot({
			animations: "disabled",
			caret: "hide",
			clip: strip,
		});

	const before = await shot();
	await page.addStyleTag({
		content:
			"[data-library-logo]{box-shadow:0 0 200px 200px #ff0000 !important;filter:drop-shadow(0 0 200px #ff0000) !important}",
	});
	const withShadow = await shot();

	expect(withShadow.equals(before)).toBe(true);

	// And the shadow really is drawn: with the box no longer holding it in,
	// the same strip of the bar changes.
	await page.addStyleTag({
		content: "[data-brand-logo-box]{overflow:visible !important}",
	});
	const withoutTheBox = await shot();

	expect(withoutTheBox.equals(before)).toBe(false);
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
		// The box holds the full cap until the render after the logo loads.
		await expect
			.poll(() => box.evaluate((element: HTMLElement) => element.offsetWidth))
			.toBeLessThan(logoBoxes.header.cap);

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
