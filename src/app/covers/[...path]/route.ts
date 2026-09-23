import { getLibraryConfig } from "@/config/library-config/server";

/** A cover from the library's public storage, served from this site so Next's image optimizer can resize it (see CoverImage). Only images in the public bucket come through. */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
	const { path } = await params;
	if (path.some((segment) => segment === "." || segment === "..")) return new Response(null, { status: 404 });
	const { url, publicBucket } = (await getLibraryConfig()).services.storage;
	const upstream = await fetch(`${url}/storage/v1/object/public/${publicBucket}/${path.map(encodeURIComponent).join("/")}`);
	const type = upstream.headers.get("content-type") ?? "";
	if (!upstream.ok || !type.startsWith("image/")) return new Response(null, { status: 404 });
	return new Response(upstream.body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400" } });
}
