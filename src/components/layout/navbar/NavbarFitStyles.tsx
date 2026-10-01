import "server-only";

import { getLibraryConfig } from "@/config/library-config/server";
import { computeNavbarFit, navbarFitCss } from "@/lib/navbar-fit";

/**
 * A worker's first page fetches the font and logo to measure them. A slow host
 * must not hold that page up: past this, it uses the fixed breakpoints while
 * the measurement finishes for the next page.
 */
const FIRST_MEASUREMENT_WAIT_MS = 1_500;

/**
 * Decides, in CSS, when the header shows its links and its actions inline. The
 * widths come from this library's own links and font (src/lib/navbar-fit.ts),
 * so the switch happens exactly when the row stops fitting, in every browser
 * and on the first frame. Without a measurement it falls back to the fixed
 * xl and 2xl breakpoints.
 */
export async function NavbarFitStyles({ locale }: { locale: string }) {
	const config = await getLibraryConfig();
	const fit = await Promise.race([
		computeNavbarFit(config, locale, config.identity.assets.logoLight),
		new Promise<null>((resolve) => setTimeout(() => resolve(null), FIRST_MEASUREMENT_WAIT_MS)),
	]);
	return <style data-navbar-fit={fit ? `${fit.links} ${fit.full}` : "fallback"}>{navbarFitCss(fit)}</style>;
}
