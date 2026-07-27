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
