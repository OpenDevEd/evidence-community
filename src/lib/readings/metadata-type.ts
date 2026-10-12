import { normalizeDoi } from "@/lib/doi";
import type { StudyTypeKey } from "./study-types";

/** DOI prefixes of registries that hold only plans: INPLASY protocols and OSF registrations. */
const REGISTRY_DOIS = ["10.37766/", "10.17605/"];

/**
 * The study type a record's own metadata gives, when it gives one, so Jev is not asked: datasets and software from
 * the record's type, corrections, front matter and editorials from OpenAlex's type, and protocols from a registry DOI.
 */
export function metadataStudyType(record: { itemType: string; openAlexType: string | null; doi: string | null }): StudyTypeKey | null {
	if (record.itemType === "Dataset" || record.itemType === "ComputerProgram") return "not-research";
	if (["dataset", "software", "erratum", "paratext", "retraction"].includes(record.openAlexType ?? "")) return "not-research";
	if (["editorial", "letter"].includes(record.openAlexType ?? "")) return "commentary";
	const doi = normalizeDoi(record.doi)?.toLowerCase();
	if (doi && REGISTRY_DOIS.some((prefix) => doi.startsWith(prefix))) return "protocol";
	return null;
}
