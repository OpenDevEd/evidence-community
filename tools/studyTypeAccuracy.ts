/**
 * How often Jev's study types are right, measured two ways on one library (OpenDevEd/new-el#592).
 *
 *   DATABASE_URL=… npm run -s readings:accuracy -- pubmed
 *     Compares Jev's types with the publication types PubMed's indexers gave the records PubMed holds: meta-analysis,
 *     systematic review and randomised trial. Only citations PubMed has fully indexed (status MEDLINE) count: the others
 *     have not had their types assigned yet.
 *   DATABASE_URL=… npm run -s readings:accuracy -- sample 200 > sheet.tsv
 *     A random sample of read records as a sheet to type blind, without Jev's answer.
 *   DATABASE_URL=… npm run -s readings:accuracy -- score sheet.tsv
 *     Compares the types in the sheet's last column with Jev's.
 *
 * Only records Jev typed are measured; those typed from their metadata, and editors' corrections, are left out.
 */
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { abstractPlainText } from "../src/lib/abstract-text";
import { STUDY_TYPE_KEYS, studyType } from "../src/lib/readings/study-types";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const query = async <Row>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as Row[];

/**
 * PubMed's tags and the type Jev should have given a record with one. A meta-analysis is also tagged a systematic
 * review, and Jev's systematic reviews include scoping reviews, which PubMed tags apart.
 */
const PUBMED = [
	{ tags: ["Meta-Analysis"], type: "meta-analysis", unless: null },
	{ tags: ["Systematic Review", "Scoping Review"], type: "systematic-review", unless: "Meta-Analysis" },
	{ tags: ["Randomized Controlled Trial"], type: "rct", unless: null },
] as const;
/** NCBI asks for no more than three requests a second without a key. */
const PUBMED_BATCH = 200;
const PUBMED_PAUSE_MS = 400;

const busy = (status: number) => status === 429 || status >= 500;

/** One batch of PubMed's full records, asked again a few times when PubMed is busy or briefly down. */
async function fetchPubmed(pmids: string[]) {
	for (let attempt = 1; ; attempt++) {
		const response = await fetch("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "OpenScholar Evidence Library study type check (new-el#592)" },
			body: new URLSearchParams({ db: "pubmed", retmode: "xml", id: pmids.join(",") }),
		});
		if (attempt === 4 || !busy(response.status)) return response;
		await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
	}
}

/** Each fully indexed record's PubMed id and publication types, from a batch of PubMed's XML. */
function fullyIndexed(xml: string) {
	return xml.split("<PubmedArticle>").slice(1).filter((article) => /<MedlineCitation[^>]*Status="MEDLINE"/.test(article)).flatMap((article): [string, string[]][] => {
		const pmid = /<PMID[^>]*>(\d+)<\/PMID>/.exec(article)?.[1];
		return pmid ? [[pmid, [...article.matchAll(/<PublicationType[^>]*>([^<]+)<\/PublicationType>/g)].map((match) => match[1]!)]] : [];
	});
}

/** The publication types of each PubMed record that is fully indexed, from its full record. */
async function pubmedTypes(pmids: string[]) {
	const types = new Map<string, string[]>();
	for (let start = 0; start < pmids.length; start += PUBMED_BATCH) {
		const batch = pmids.slice(start, start + PUBMED_BATCH);
		const response = await fetchPubmed(batch);
		if (!response.ok) throw new Error(`PubMed answered ${response.status} for records ${start} to ${start + batch.length}`);
		for (const [pmid, tags] of fullyIndexed(await response.text())) types.set(pmid, tags);
		await new Promise((resolve) => setTimeout(resolve, PUBMED_PAUSE_MS));
	}
	return types;
}

async function comparePubmed() {
	const rows = await query<{ key: string; type: string; pmid: string }>(`
		SELECT r."itemKey" AS key, r."studyType" AS type, substring(s.pmid FROM '(\\d+)\\s*$') AS pmid
		FROM "itemReading" r
		JOIN LATERAL (SELECT payload->'ids'->>'pmid' AS pmid FROM "sourceSnapshot" WHERE "itemKey" = r."itemKey" AND payload->'ids' ? 'pmid'
			ORDER BY "fetchedAt" DESC LIMIT 1) s ON true
		WHERE r."typedBy" = 'ai'`);
	const tagged = await pubmedTypes(rows.map((row) => row.pmid));
	const indexed = rows.filter((row) => tagged.has(row.pmid));
	const tagsOf = (row: (typeof rows)[number]) => tagged.get(row.pmid)!;
	const result = PUBMED.map(({ tags, type, unless }) => {
		const pubmed = indexed.filter((row) => tags.some((tag) => tagsOf(row).includes(tag)) && !(unless && tagsOf(row).includes(unless)));
		const jev = indexed.filter((row) => row.type === type);
		const both = pubmed.filter((row) => row.type === type).length;
		return { tags, type, pubmed: pubmed.length, jev: jev.length, both, recall: share(both, pubmed.length), precision: share(both, jev.length) };
	});
	// Of the records Jev called a meta-analysis or a systematic review, the share PubMed typed the same. Trials are left
	// out: PubMed tags only clinical trials, while Jev's include randomised field, laboratory and behavioural experiments.
	const reviews = result.filter((row) => row.type !== "rct");
	const confirmed = share(reviews.reduce((sum, row) => sum + row.both, 0), reviews.reduce((sum, row) => sum + row.jev, 0));
	console.log(JSON.stringify({ measured: new Date().toISOString().slice(0, 10), withPmid: rows.length, fullyIndexed: indexed.length, confirmed, result }, null, 2));
}

const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
const cell = (text: string) => text.replace(/[\t\r\n]+/g, " ").trim();

async function sampleSheet(size: number) {
	const rows = await query<{ key: string; title: string | null; abstract: string | null; doi: string | null }>(`
		SELECT i.key, i.title, i."abstractNote" AS abstract, i."DOI" AS doi FROM "itemReading" r JOIN item i ON i.key = r."itemKey"
		WHERE r."typedBy" = 'ai' ORDER BY random() LIMIT $1`, [size]);
	console.log(["key", "title", "abstract", "doi", `type (${STUDY_TYPE_KEYS.join(", ")})`].join("\t"));
	for (const row of rows) console.log([row.key, cell(row.title ?? ""), cell(abstractPlainText(row.abstract).slice(0, 3000)), row.doi ?? "", ""].join("\t"));
}

/** The typed rows of a filled sheet: each record's key and the type in its last column. */
function readSheet(path: string) {
	const checked = readFileSync(path, "utf8").trim().split("\n").slice(1).map((line) => line.split("\t"))
		.map((cells) => ({ key: cells[0]!, type: cells.at(-1)!.trim() })).filter((row) => row.type);
	const unknown = checked.filter((row) => !(STUDY_TYPE_KEYS as readonly string[]).includes(row.type));
	if (unknown.length) throw new Error(`Not a study type: ${unknown.map((row) => `${row.key} ${row.type}`).join(", ")}`);
	return checked;
}

/** The eight disagreements seen most often, as "the sheet's type read as Jev's type". */
function mostConfused(misread: string[]) {
	const counts = new Map<string, number>();
	for (const pair of misread) counts.set(pair, (counts.get(pair) ?? 0) + 1);
	return [...counts].sort((left, right) => right[1] - left[1]).slice(0, 8);
}

/** Jev's type for each key. A key with no reading stops the score: the record is gone, or the sheet is another library's. */
async function jevTypes(keys: string[]) {
	const jev = new Map((await query<{ key: string; type: string }>(`SELECT "itemKey" AS key, "studyType" AS type FROM "itemReading" WHERE "itemKey" = ANY($1)`, [keys])).map((row) => [row.key, row.type]));
	const missing = keys.filter((key) => !jev.has(key));
	if (missing.length) throw new Error(`No reading in this library for ${missing.join(", ")}`);
	return jev;
}

async function scoreSheet(path: string) {
	const checked = readSheet(path);
	const jev = await jevTypes(checked.map((row) => row.key));
	const byType = STUDY_TYPE_KEYS.map((type) => {
		const sheet = checked.filter((row) => row.type === type);
		return { type, sheet: sheet.length, agreed: sheet.filter((row) => jev.get(row.key) === type).length };
	}).filter((row) => row.sheet);
	const agreed = checked.filter((row) => jev.get(row.key) === row.type).length;
	// The same level of evidence (reviews and syntheses, primary studies, other work), as the Study types card groups them.
	const sameLevel = checked.filter((row) => studyType(jev.get(row.key) ?? "")?.level === studyType(row.type)?.level).length;
	const misread = checked.filter((row) => jev.get(row.key) !== row.type).map((row) => `${row.type} read as ${jev.get(row.key)}`);
	console.log(JSON.stringify({ measured: new Date().toISOString().slice(0, 10), checked: checked.length, agreed, agreement: share(agreed, checked.length), sameLevel: share(sameLevel, checked.length), byType, mostConfused: mostConfused(misread) }, null, 2));
}

const COMMANDS: Record<string, (argument?: string) => Promise<void>> = {
	pubmed: () => comparePubmed(),
	sample: (size) => sampleSheet(Number(size ?? 200)),
	score: (path) => scoreSheet(path!),
};

async function main() {
	const [command = "", argument] = process.argv.slice(2);
	const run = COMMANDS[command];
	if (!run) throw new Error("Use: pubmed | sample <size> | score <sheet.tsv>");
	await run(argument);
}

main().finally(() => pool.end()).catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
