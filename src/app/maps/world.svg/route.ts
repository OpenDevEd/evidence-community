import { gzipSync } from "node:zlib";
import { getWorldMap } from "@/components/pages/home-map-shapes";

let gzipped: Promise<Buffer> | undefined;

/** The world's outlines for the home page's maps. Next compresses pages but not route responses, so this one compresses itself. */
export async function GET(request: Request) {
	const headers = { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400", Vary: "Accept-Encoding" };
	if (!acceptsGzip(request.headers.get("accept-encoding"))) return new Response((await getWorldMap()).svg, { headers });
	gzipped ??= getWorldMap().then(({ svg }) => gzipSync(svg));
	return new Response(new Uint8Array(await gzipped), { headers: { ...headers, "Content-Encoding": "gzip" } });
}

/** Whether a client takes gzip: named (or covered by "*") with a quality above zero, as in "gzip;q=0.8". */
function acceptsGzip(header: string | null) {
	const quality = (name: string) => {
		const entry = (header ?? "").split(",").map((part) => part.trim().split(";")).find(([coding]) => coding?.trim().toLowerCase() === name);
		if (!entry) return undefined;
		const q = entry.slice(1).map((param) => /^\s*q=([\d.]+)\s*$/iu.exec(param)?.[1]).find(Boolean);
		return q === undefined ? 1 : Number(q);
	};
	return (quality("gzip") ?? quality("*") ?? 0) > 0;
}
