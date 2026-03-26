import "server-only";
import { readdir } from "fs/promises";
import { join } from "path";
import config from "@/constants/config.json";
import type { GapMap } from "@/lib/gapmap-links";
import { cacheLife, cacheTag } from "next/cache";
export type { GapMap };

const GAPMAPS_DIR = join(process.cwd(), "public", "gapmaps");

const LABEL_MAP: Record<string, string> = {
	"fcdo-evaluation-evidence": "FCDO Evaluation Evidence",
	"redd-rq-op-intervention-type": "REDD+ RQ-OP-Intervention Type",
	"redd-egm-outcomes-scale-ca": "REDD+ EGM Outcomes Scale CA",
};

const DESCRIPTION_MAP: Record<string, string> = {
	"fcdo-evaluation-evidence":
		"An interactive evidence gap map covering FCDO evaluation evidence across sectors and themes.",
	"redd-rq-op-intervention-type":
		"Maps REDD+ research questions and operational intervention types to identify evidence gaps.",
	"redd-egm-outcomes-scale-ca":
		"Visualises REDD+ evidence by outcomes, scale, and causal assumptions.",
};

function getIndex(): string {
	return process.env.MEILI_INDEX || config.index;
}

export async function getGapMaps(): Promise<GapMap[]> {
	'use cache'
	cacheLife({ revalidate: 3600 })
	cacheTag('gapmaps')

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
					description: DESCRIPTION_MAP[slug],
				};
			});
	} catch {
		return [];
	}
}
