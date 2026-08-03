/**
 * Strip trailing slash(es) so exact pathname comparisons (e.g. `=== "/lib"`)
 * match both `/lib` and `/lib/`.
 *
 * `next.config.mjs` sets `skipTrailingSlashRedirect: true`, so Next.js does NOT
 * normalize `/lib/` -> `/lib` for us; next-intl serves the page either way (via
 * an internal rewrite) but leaves the trailing slash on the pathname. Without
 * this, a trailing-slash URL silently fails strict route checks (e.g. the
 * library filter surface never enables, so collections don't render).
 *
 * Dependency-free on purpose: also imported by the edge middleware (`proxy.ts`).
 * The root path `/` is preserved.
 */
export function normalizePathname(pathname: string): string {
	return pathname.replace(/\/+$/, "") || "/";
}

export function isAdminPath(pathname: string, locale: string): boolean {
	const segments = normalizePathname(pathname).split("/").filter(Boolean);
	return (
		segments[0] === "admin" ||
		(segments[0] === locale && segments[1] === "admin")
	);
}
