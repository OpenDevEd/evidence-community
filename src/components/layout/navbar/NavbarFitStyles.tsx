import "server-only";

import { getLibraryConfig } from "@/config/library-config/server";
import { computeNavbarFit, navbarFitCss } from "@/lib/navbar-fit";

/**
 * Decides, in CSS, when the header shows its links and its actions inline. The
 * widths come from this library's own links and font (src/lib/navbar-fit.ts),
 * so the switch happens exactly when the row stops fitting, in every browser
 * and on the first frame. Without a measurement it falls back to the fixed
 * xl and 2xl breakpoints.
 */
export async function NavbarFitStyles({ locale }: { locale: string }) {
	const config = await getLibraryConfig();
	const fit = await computeNavbarFit(config, locale, config.identity.assets.logoLight);
	return <style data-navbar-fit={fit ? `${fit.links} ${fit.full}` : "fallback"}>{navbarFitCss(fit)}</style>;
}
