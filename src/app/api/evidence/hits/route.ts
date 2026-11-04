import { readFile } from "node:fs/promises";
import path from "node:path";
import { connection, NextRequest, NextResponse } from "next/server";
import { EVIDENCE_DATA, labelOfRecord } from "@/components/pages/evidence/data";
import { hasEvidenceMap } from "@/components/pages/evidence/server-data";
import { getPublicItemKeys, getPublicItemsByKeys } from "@/lib/search";
import { readPublicRequest } from "@/lib/public-query";

/** Most records one answer lights up: more than any search here finds. */
const MOST = 300_000;
/** The first results sent with their lines (who, year, title), so the panel's first pages need no second request: five pages of eight. */
const LINED = 40;

/** Every record key's point on the map, read once from the built data in public/. */
let points: Promise<{ count: number; byKey: Map<string, number> }> | null = null;
function mapPoints() {
	points ??= (async () => {
		const dir = path.join(process.cwd(), "public", EVIDENCE_DATA);
		const [keys, meta] = await Promise.all([readFile(path.join(dir, "keys.txt"), "utf8"), readFile(path.join(dir, "meta.json"), "utf8").then(JSON.parse)]);
		const byKey = new Map<string, number>();
		for (let i = 0; i < keys.length / 8; i++) byKey.set(keys.slice(i * 8, i * 8 + 8), i);
		return { count: meta.points as number, byKey };
	})();
	return points;
}

/**
 * What a search finds on the evidence map: the point of every record on it the library's search finds, in the search's order,
 * which the map lights and the panel lists, with the first ones' lines. Records the map does not draw are left out. `limit` asks
 * for the first few thousand quickly; a second request fetches all of them.
 */
export async function GET(request: NextRequest) {
	// Answered per request: which library is asking is only known at run time.
	await connection();
	if (!(await hasEvidenceMap())) return NextResponse.json({ error: "not_found" }, { status: 404 });
	const url = new URL(request.url);
	const limit = Math.min(MOST, Math.max(1, Number(url.searchParams.get("limit")) || 5000));
	url.searchParams.delete("limit");
	const query = await readPublicRequest(new NextRequest(url), { paged: false, perPage: false, includeHeavyFields: false });
	if (query instanceof NextResponse) return query;
	const [{ keys, total }, { byKey }] = await Promise.all([getPublicItemKeys(query.params, limit, request.signal), mapPoints()]);
	const onMap = keys.filter((key) => byKey.has(key));
	const records = await getPublicItemsByKeys(onMap.slice(0, LINED));
	const lines = records.map((record) => { const { who, year, title } = labelOfRecord(record); return [byKey.get(record.key)!, who, year, title ?? null]; });
	return NextResponse.json({ total, found: keys.length, order: onMap.map((key) => byKey.get(key)!), lines });
}
