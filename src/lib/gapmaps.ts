import "server-only";
import { readdir } from "fs/promises";
import { join } from "path";
import config from "@/constants/config.json";
import type { GapMap } from "@/lib/gapmap-links";
export type { GapMap };

const GAPMAPS_DIR = join(process.cwd(), "public", "gapmaps");

const LABEL_MAP: Record<string, string> = {
	"fcdo-evaluation-evidence": "FCDO Evaluation Evidence",
};

function getIndex(): string {
	return process.env.MEILI_INDEX || config.index;
}

export async function getGapMaps(): Promise<GapMap[]> {
	const index = getIndex();
	const dir = join(GAPMAPS_DIR, index);

	try {
		const files = await readdir(dir);
		return files
			.filter((f) => f.endsWith(".html"))
			.map((f) => {
				const slug = f.replace(".html", "");
				return {
					slug,
					label: LABEL_MAP[slug] ?? slug.replace(/[_-]/g, " "),
					href: `/gapmaps/${f}`,
				};
			});
	} catch {
		return [];
	}
}
