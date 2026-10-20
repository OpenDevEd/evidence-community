import { vi } from "vitest";

/**
 * jsdom has no layout: every box is 0px tall and there is no ResizeObserver, so a list paged to fit its panel never measures
 * and draws no rows. This gives boxes a height and reports each observed box once, as a browser does on observe.
 */
export function stubPanelLayout(height = 900) {
	vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(height);
	vi.stubGlobal("ResizeObserver", class {
		constructor(private readonly report: ResizeObserverCallback) {}
		observe() { queueMicrotask(() => this.report([], this as unknown as ResizeObserver)); }
		unobserve() {}
		disconnect() {}
	});
}
