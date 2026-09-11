import { getRedirectLookupPath } from "@/lib/runtime-routing";
import { PLATFORM_LOCALES } from "./catalogs";
import type { LibraryPublicConfig } from "./schema";

export type RuntimeNavigationLink =
	LibraryPublicConfig["navigation"]["links"][number];
export type RuntimeLeafLink = RuntimeNavigationLink["children"][number];
export type RuntimeLink = Pick<
	RuntimeLeafLink,
	"href" | "target" | "visible"
>;

export function getVisibleRuntimeLinks<T extends RuntimeLink>(
	links: readonly T[],
): T[] {
	return links.filter((link) => link.visible);
}

export function getRuntimeInternalHrefPath(href: string): string | null {
	if (!href.startsWith("/")) return null;

	const delimiterIndex = href.search(/[?#]/u);
	const path = delimiterIndex === -1 ? href : href.slice(0, delimiterIndex);

	return path.length > 1 ? path.replace(/\/+$/u, "") : path;
}

export function getRuntimePagePath(href: string, baseUrl: string): string | null {
	const base = new URL(baseUrl);
	const target = new URL(href, base);
	if (target.origin !== base.origin) return null;
	const segments = target.pathname.split("/").filter(Boolean);
	if (PLATFORM_LOCALES.some(locale => locale === segments[0])) segments.shift();
	return getRuntimeInternalHrefPath(`/${segments.join("/")}`);
}

/** Let locale-aware links handle same-origin URLs as internal navigation. */
export function getRuntimeLinkHref(href: string, baseUrl: string): string {
	const pathname = getRuntimePagePath(href, baseUrl);
	if (pathname === null) return href;
	const target = new URL(href, baseUrl);
	// Static files, API routes and addresses outside the app do not take locales.
	if (pathname.includes(".") || /^\/api(?:\/|$)/u.test(pathname) || getRedirectLookupPath(pathname, true) !== null) return target.href;
	return `${pathname}${target.search}${target.hash}`;
}

export function hasRuntimeLinkPath<T extends Pick<RuntimeLink, "href">>(
	links: readonly T[],
	path: string,
): boolean {
	const normalizedPath = getRuntimeInternalHrefPath(path);
	if (!normalizedPath) return false;

	return links.some(
		(link) => getRuntimeInternalHrefPath(link.href) === normalizedPath,
	);
}

export function hasRuntimeNavigationPath(
	links: readonly RuntimeNavigationLink[],
	path: string,
): boolean {
	return (
		hasRuntimeLinkPath(links, path) ||
		links.some((link) => hasRuntimeLinkPath(link.children, path))
	);
}

export function getRuntimeLinkAnchorProps(link: RuntimeLink) {
	return link.target === "blank"
		? {
				target: "_blank" as const,
				rel: "noopener noreferrer",
			}
		: {};
}

export function getRuntimeHomeHref(
	links: readonly RuntimeNavigationLink[],
): string {
	return links.find((link) => link.id === "home")?.href ?? "/";
}
