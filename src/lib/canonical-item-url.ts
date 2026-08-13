function parseUrl(value: string | null | undefined) {
	if (!value) return null;
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

function canonicalPath(pathname: string) {
	const parts = pathname.split("/").filter(Boolean);
	const libraryIndex = parts.indexOf("lib");
	const key = libraryIndex === -1 ? undefined : parts[libraryIndex + 1];
	return key ? `/lib/${key}` : null;
}

function canonicalHost(host: string) {
	return host.toLowerCase().replace(/^www\./u, "");
}

export function getCanonicalWebsiteItemUrl(
	item: { key: string; url?: string | null },
	baseUrl: string,
) {
	const itemUrl = parseUrl(item.url);
	const canonicalBaseUrl = parseUrl(baseUrl);
	if (!itemUrl || !canonicalBaseUrl) return null;
	if (canonicalHost(itemUrl.host) !== canonicalHost(canonicalBaseUrl.host)) {
		return null;
	}
	if (canonicalPath(itemUrl.pathname) !== `/lib/${item.key}`) return null;
	return itemUrl;
}
