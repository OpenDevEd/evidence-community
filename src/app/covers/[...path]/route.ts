import { getLibraryConfig } from "@/config/library-config/server";

/** Raster covers only: anything else in the bucket, an SVG above all, is never served from this site. */
const COVER_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function notFound() {
	return new Response(null, { status: 404 });
}

/**
 * A cover from the library's public storage, served from this site so Next's image optimizer can resize it (see
 * CoverImage). The path names the storage host and bucket the cover was stored in; only the library's own answer.
 */
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
	// One address per file: a query string would be a new cache entry and a new download each time.
	if (new URL(request.url).search) return notFound();
	const [host, bucket, ...path] = (await params).path;
	const { url, publicBucket } = (await getLibraryConfig()).services.storage;
	if (host !== new URL(url).host || bucket !== publicBucket || path.length === 0 || path.some((segment) => segment === "." || segment === "..")) return notFound();
	const upstream = await fetch(`${url}/storage/v1/object/public/${publicBucket}/${path.map(encodeURIComponent).join("/")}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
	const type = upstream?.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
	if (!upstream?.ok || !COVER_TYPES.has(type)) return notFound();
	return new Response(upstream.body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
}
