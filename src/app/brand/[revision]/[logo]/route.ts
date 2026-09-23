import { getLibraryConfig } from "@/config/library-config/server";

/**
 * The library's light or dark logo, served from this site so Next's image optimizer can resize it (see
 * LibraryIdentity). Only the two configured logo files come through; the revision in the address only keeps a
 * replaced logo out of old caches.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ logo: string }> }) {
	const { logo } = await params;
	const { assets } = (await getLibraryConfig()).identity;
	const source = { "logo-light": assets.logoLight ?? assets.logoDark, "logo-dark": assets.logoDark }[logo.replace(/\.\w+$/u, "")];
	if (!source) return new Response(null, { status: 404 });
	const upstream = await fetch(source);
	const type = upstream.headers.get("content-type") ?? "";
	if (!upstream.ok || !type.startsWith("image/")) return new Response(null, { status: 404 });
	return new Response(upstream.body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400" } });
}
