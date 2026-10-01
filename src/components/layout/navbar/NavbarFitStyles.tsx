import "server-only";

import { getLibraryConfig } from "@/config/library-config/server";
import { computeNavbarFit } from "@/lib/navbar-fit";

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
	const when = (width: number, fallback: string) =>
		fit ? `@container navbar (min-width: ${width}px)` : `@media (min-width: ${fallback})`;
	const css = `
.navbar-bar { container: navbar / inline-size; }
.nf-links, .nf-actions-condensed, .nf-actions-full { display: none !important; }
${when(fit?.links ?? 0, "1280px")} {
	.nf-links { display: flex !important; }
	.nf-actions-condensed { display: block !important; }
	.nf-compact { display: none !important; }
}
${when(fit?.full ?? 0, "1536px")} {
	.nf-actions-condensed { display: none !important; }
	.nf-actions-full { display: block !important; }
}`;
	return <style data-navbar-fit={fit ? `${fit.links} ${fit.full}` : "fallback"}>{css}</style>;
}
