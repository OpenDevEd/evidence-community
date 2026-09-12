import { getCachedItemSmall } from "@/app/api/cache";
import { getLibraryConfig } from "@/config/library-config/server";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";
import { renderPublicationShareImage } from "@/lib/publication-share-image";

export async function GET(_request: Request, context: { params: Promise<{ key: string }> }) {
	const { key } = await context.params;
	const [{ item }, config] = await Promise.all([
		getCachedItemSmall(key),
		getLibraryConfig(),
	]);
	if (!item) return new Response(null, { status: 404 });
	const image = await renderPublicationShareImage(item.title || config.identity.name, config.identity.name, new URL(config.identity.baseUrl).hostname);
	return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/png", "Cache-Control": PUBLIC_READ_CACHE_CONTROL } });
}
