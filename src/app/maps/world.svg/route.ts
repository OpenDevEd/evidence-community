import { gzipSync } from "node:zlib";
import { getWorldMap } from "@/components/pages/home-map-shapes";

let gzipped: Promise<Buffer> | undefined;

/** The world's outlines for the home page's maps. Next compresses pages but not route responses, so this one compresses itself. */
export async function GET(request: Request) {
	const headers = { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400", Vary: "Accept-Encoding" };
	if (!request.headers.get("accept-encoding")?.includes("gzip")) return new Response((await getWorldMap()).svg, { headers });
	gzipped ??= getWorldMap().then(({ svg }) => gzipSync(svg));
	return new Response(new Uint8Array(await gzipped), { headers: { ...headers, "Content-Encoding": "gzip" } });
}
