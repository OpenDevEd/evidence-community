/**
 * What kind of work a record is, as Jev reads it from the title and abstract when the record comes in. The levels are
 * the evidence's own: primary studies, the syntheses that pool or sum them up, and the reviews of those syntheses.
 * The descriptions are what Jev is told each type means, so they are also what readers are told.
 */
export const STUDY_LEVELS = [
	{ key: "synthesis", label: "Reviews and syntheses" },
	{ key: "primary", label: "Primary studies" },
	{ key: "other", label: "Other work" },
] as const;
export type StudyLevel = (typeof STUDY_LEVELS)[number]["key"];

export const STUDY_TYPES = [
	{ key: "review-of-reviews", level: "synthesis", label: "Review of reviews", plural: "Reviews of reviews", description: "Gathers and sums up earlier reviews or meta-analyses, such as an umbrella review." },
	{ key: "meta-analysis", level: "synthesis", label: "Meta-analysis", plural: "Meta-analyses", description: "The authors statistically pool results from several earlier studies themselves. Quoting someone else's pooled result does not count." },
	{ key: "systematic-review", level: "synthesis", label: "Systematic review", plural: "Systematic reviews", description: "Sums up earlier studies found with a stated search and inclusion rules, without pooling them. Includes scoping and rapid reviews." },
	{ key: "literature-review", level: "synthesis", label: "Literature review", plural: "Other literature reviews", description: "A narrative, critical or integrative review with no stated search method." },
	{ key: "bibliometric", level: "synthesis", label: "Bibliometric study", plural: "Bibliometric studies", description: "Counts and maps publications, authors or citations on a topic, rather than what the studies found." },
	{ key: "rct", level: "primary", label: "Randomised trial", plural: "Randomised trials", description: "Participants, groups or places were randomly assigned to conditions." },
	{ key: "quasi-experiment", level: "primary", label: "Quasi-experiment", plural: "Quasi-experiments", description: "An intervention compared with a comparison group chosen without random assignment." },
	{ key: "quantitative", level: "primary", label: "Quantitative study", plural: "Other quantitative", description: "Surveys, correlational and observational studies, single-group before-and-after tests, analyses of existing data." },
	{ key: "qualitative", level: "primary", label: "Qualitative study", plural: "Qualitative and mixed", description: "Interviews, focus groups, case studies, ethnography or document analysis, alone or with quantitative data." },
	{ key: "modelling", level: "primary", label: "Modelling study", plural: "Modelling studies", description: "Builds, simulates, projects or tests a model, method, tool or system, judged on how well it performs." },
	{ key: "protocol", level: "other", label: "Protocol", plural: "Protocols", description: "A study or review that is planned or under way, with no results yet." },
	{ key: "commentary", level: "other", label: "Commentary", plural: "Commentaries", description: "An editorial, opinion, policy analysis, theory or framework with no new data." },
	{ key: "not-research", level: "other", label: "Not a research paper", plural: "Not research papers", description: "A dataset, software, correction, book review, or a file that accompanies another paper." },
] as const satisfies readonly { key: string; level: StudyLevel; label: string; plural: string; description: string }[];
export type StudyTypeKey = (typeof STUDY_TYPES)[number]["key"];
/** The reviews and syntheses, in the order a reader starts from. */
export const SYNTHESIS_TYPES: StudyTypeKey[] = STUDY_TYPES.filter((type) => type.level === "synthesis").map((type) => type.key);
export const studyType = (key: string) => STUDY_TYPES.find((type) => type.key === key);

/** One record's reading: its type, how sure Jev was, and whether the record's own metadata said it instead. */
export type StudyReading = { type: StudyTypeKey; confidence: number; by: "ai" | "metadata"; input: "abstract" | "title" };
/** Below this, the type is shown as uncertain. */
export const SURE = 0.6;

/** How types are read, as readers are told wherever types appear. */
export const STUDY_TYPE_METHOD =
	"Each record's type is read when it enters the library. Jev, an AI classifier, reads its title and abstract and picks one of these types; a record with no abstract is judged on its title. Datasets, software, corrections and registered protocols are typed from the record itself, without AI. A type Jev is less than 60% sure of is marked uncertain. An editor can correct any type.";
