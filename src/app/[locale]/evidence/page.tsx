import EvidenceMap from "@/components/pages/evidence/EvidenceMap";
import { EVIDENCE_DATA, type ChainEntry } from "@/components/pages/evidence/data";
import { hasEvidenceMap, readEvidenceData } from "@/components/pages/evidence/server-data";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { preload } from "react-dom";

// Next.js reads this route export.
export const instant = false;

/** The library's papers as a map of who cites whom, with the evidence checks laid over it, built offline for AIED. */
export default async function EvidencePage() {
	await connection();
	if (!(await hasEvidenceMap())) notFound();
	// The map's first frame needs these three files: they start downloading with the page, before the script that reads them.
	for (const file of ["meta.json", "places.json", "points.bin.gz"]) preload(`${EVIDENCE_DATA}/${file}`, { as: "fetch", crossOrigin: "anonymous" });
	// The chains list and the checks' counts are in the page itself, so the panels are whole from the first frame.
	const [chains, meta] = await Promise.all([readEvidenceData<ChainEntry[]>("chains.json"), readEvidenceData<{ verdicts: Record<string, number> }>("meta.json")]);
	return <EvidenceMap chains={chains} verdictCounts={meta.verdicts} />;
}
