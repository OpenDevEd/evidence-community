import { getLibraryConfig } from "@/config/library-config/server";
import { fetchPublicFile } from "@/lib/public-fetch";

/** Raster logos only: an SVG served from this site could run script here, and loads from its own address instead. */
const LOGO_TYPES = new Set(["image/png", "image/webp"]);
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

function notFound() {
	return new Response(null, { status: 404 });
}

/**
 * The library's light or dark logo, served from this site so Next's image optimizer can resize it (see
 * LibraryIdentity). Only the active revision's two configured logo files answer, under their own extension, so an
 * address for a later revision cannot be cached early with today's logo.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ revision: string; logo: string }> }) {
	const { revision, logo } = await params;
	const config = await getLibraryConfig();
	const { assets } = config.identity;
	const match = /^logo-(light|dark)(\.\w+)$/u.exec(logo);
	const source = match && { light: assets.logoLight ?? assets.logoDark, dark: assets.logoDark }[match[1] as "light" | "dark"];
	if (!match || !source || revision !== config.revision || !new URL(source).pathname.endsWith(match[2]!)) return notFound();
	try {
		const { data, contentType } = await fetchPublicFile(new URL(source), { accept: [...LOGO_TYPES].join(","), timeoutMs: 10_000, maxBytes: MAX_LOGO_BYTES });
		const type = contentType.split(";")[0]!.trim().toLowerCase();
		if (!LOGO_TYPES.has(type)) return notFound();
		return new Response(new Uint8Array(data), { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
	} catch {
		return notFound();
	}
}
