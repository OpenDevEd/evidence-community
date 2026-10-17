/** A part of the screen, in pixels. */
export type Area = { left: number; right: number; top: number; bottom: number };

const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/**
 * Wide: the search panel on the left, the paper's on the right, and the notices over the map under the header, each 2.75 rem high
 * with 0.5 rem below it: the one that says what is in front whenever a paper is open (counted, as it is not on the page yet while
 * the paper opens), and the filter's while it is on.
 */
function wideArea(withPaper: boolean, width: number, height: number): Area {
	const r = rem();
	const notices = Number(withPaper) + Number(Boolean(document.querySelector("[data-evidence-notice=filter]")));
	return { left: 24 * r, right: withPaper ? width - 27 * r : width, top: (7 + notices * 3.25) * r, bottom: height - r };
}

/**
 * Narrower: the search and checks at the top, the sheet along the bottom (half the screen while it holds something), or down
 * the right when the screen lies down. These layouts measure their top bar and sheet: their layout sizes, which a sheet's
 * animation does not change. A paper about to open will fill half the screen, whatever the sheet holds now.
 */
function narrowArea(withPaper: boolean, width: number, height: number): Area {
	const top = document.querySelector<HTMLElement>("[data-evidence-top]"), sheet = document.querySelector<HTMLElement>("[data-evidence-sheet]");
	const below = top ? top.offsetTop + top.offsetHeight + 8 : 11.5 * rem();
	if (width > height) return { left: 8, right: width - Math.min(26 * rem(), width * 0.55) - 8, top: below, bottom: height - 8 };
	const sheetHeight = Math.max(sheet?.offsetHeight ?? 0, withPaper ? height * 0.5 : 0);
	return { left: 8, right: width - 8, top: below, bottom: height - sheetHeight - 8 };
}

/**
 * The part of the map's canvas between the page's panels, where a focused chain is fitted. The panels are placed against the
 * window; the canvas may start lower (below 1,280 px the header is in the page), so the area is measured in the window and
 * moved into the canvas. The panels' widths are fixed, so a chain opening with its panel still sliding in is fitted beside
 * where the panel will be.
 */
export function visibleArea(stage: HTMLElement | null, withPaper: boolean): Area {
	const width = window.innerWidth, height = window.innerHeight;
	const box = stage?.getBoundingClientRect() ?? new DOMRect(0, 0, width, height);
	const wide = window.matchMedia("(min-width: 1280px)").matches;
	const area = (wide ? wideArea : narrowArea)(withPaper, width, height);
	return { left: area.left - box.left, right: area.right - box.left, top: Math.max(0, area.top - box.top), bottom: area.bottom - box.top };
}
