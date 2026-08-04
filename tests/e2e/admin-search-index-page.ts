import type { Locator, Page } from "@playwright/test";

export function adminSearchIndexStatus(page: Page, label?: string) {
	return page.locator(
		label
			? `[data-admin-search-index-status][aria-label="Search indexing: ${label}"]`
			: "[data-admin-search-index-status]",
	);
}

export async function waitForAdminSearchIndexStatus(
	page: Page,
	label: string,
	timeout: number,
) {
	const status = adminSearchIndexStatus(page, label);
	await status.waitFor({ state: "visible", timeout });
	return status;
}

export async function measureAdminSearchIndexTrigger(status: Locator) {
	return status.evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			display: style.display,
			flexDirection: style.flexDirection,
			height: element.getBoundingClientRect().height,
			iconHeight: element
				.querySelector("svg")
				?.parentElement?.getBoundingClientRect().height,
			paddingLeft: style.paddingLeft,
			paddingRight: style.paddingRight,
			width: element.getBoundingClientRect().width,
		};
	});
}

export async function openAndMeasureAdminSearchIndexPopover(
	page: Page,
	status: Locator,
	timeout: number,
) {
	await status.click();
	const popover = page.locator("[data-admin-search-index-popover]");
	await popover.waitFor({ state: "visible", timeout });
	const geometry = await popover.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const surface = element.querySelector<HTMLElement>('[data-slot="content"]');
		const inner = element.querySelector<HTMLElement>(
			"[data-admin-search-index-content]",
		);
		const progress = element.querySelector<HTMLElement>(
			'[role="progressbar"] > div',
		);
		return {
			documentOverflow:
				document.documentElement.scrollWidth - window.innerWidth,
			innerPadding: inner ? getComputedStyle(inner).padding : null,
			progressHeight: progress?.getBoundingClientRect().height ?? null,
			rightInsideViewport: rect.right <= window.innerWidth,
			surfaceBorderRadius: surface
				? getComputedStyle(surface).borderRadius
				: null,
			surfaceBorderWidth: surface
				? getComputedStyle(surface).borderWidth
				: null,
			width: rect.width,
		};
	});
	return { geometry, popover };
}
