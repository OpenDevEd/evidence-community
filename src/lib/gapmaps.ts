import { readdir } from "fs/promises";
import { join } from "path";
import config from "@/constants/config.json";

export type GapMap = {
	slug: string;
	label: string;
};

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
			.map((f) => ({
				slug: f.replace(".html", ""),
				label: LABEL_MAP[f.replace(".html", "")] ?? f.replace(".html", "").replace(/[_-]/g, " "),
			}));
	} catch {
		return [];
	}
}
