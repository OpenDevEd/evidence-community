/**
 * The records `npm run verify -- up` adds to the fixture library, as SQL.
 * Built from a fixed seed, so the branch and origin/main see the same pages;
 * varied like a real library: long and short titles, missing abstracts, one
 * author or fourteen, many countries, every common item type.
 */

const KEY_ALPHABET = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";

function random(seed: number) {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const next = random(20261009);
const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)];
const between = (low: number, high: number) => low + Math.floor(next() * (high - low + 1));

/** An 8-character record key in Zotero's alphabet, starting with V for verify. */
function key(prefix: string, index: number) {
	let value = index;
	let tail = "";
	for (let digit = 0; digit < 8 - prefix.length; digit++) {
		tail = KEY_ALPHABET[value % KEY_ALPHABET.length] + tail;
		value = Math.floor(value / KEY_ALPHABET.length);
	}
	return prefix + tail;
}

const TOPICS = [
	"structured pedagogy",
	"early-grade reading",
	"teacher coaching",
	"mother-tongue instruction",
	"girls' secondary education",
	"school feeding",
	"remedial mathematics",
	"teaching at the right level",
	"digital learning in low-connectivity schools",
	"inclusive education for children with disabilities",
	"education in emergencies",
	"school leadership",
	"conditional cash transfers",
	"technical and vocational training",
];
const PLACES = ["rural Kenya", "Uttar Pradesh", "northern Nigeria", "Tanzania", "Bangladesh", "Sierra Leone", "Ethiopia", "Ghana", "Uganda", "Pakistan", "Malawi", "Rwanda", "Brazil", "South Africa"];
const DESIGNS = ["a cluster randomised trial", "a systematic review", "a mixed-methods evaluation", "evidence from a national assessment", "a cost-effectiveness analysis", "a qualitative study", "a quasi-experimental study"];
const SHORT_TITLES = ["Teaching at the right level", "Coaching works", "Learning poverty", "What works in girls' education", "Reading for all", "Schools after the pandemic"];

const FIRST = ["Amina", "Benedict", "Chiara", "Dawit", "Esi", "Farhan", "Grace", "Hiroshi", "Ifeoma", "Joseph", "Kavita", "Luis", "Mwajuma", "Nadia", "Oluwaseun", "Priya", "Quentin", "Rahel", "Samuel", "Tendai", "Uzma", "Victor", "Wanjiru", "Yusuf", "Zainab"];
const LAST = ["Achieng", "Banerjee", "Carvalho", "Diallo", "Eshetu", "Fofanah", "Gupta", "Haile", "Ibrahim", "Juma", "Kariuki", "Lungu", "Mensah", "Nakamura", "Okafor", "Pritchett", "Quarshie", "Rahman", "Sabates", "Tembo", "Uwimana", "Vargas", "Wamalwa", "Yeboah", "Zulu"];
const INSTITUTIONS = [
	{ display_name: "University of Nairobi", country_code: "KE" },
	{ display_name: "University of Oxford", country_code: "GB" },
	{ display_name: "Indian Institute of Technology Delhi", country_code: "IN" },
	{ display_name: "University of Ibadan", country_code: "NG" },
	{ display_name: "Universidade de São Paulo", country_code: "BR" },
	{ display_name: "University of Cape Town", country_code: "ZA" },
	{ display_name: "University of Dar es Salaam", country_code: "TZ" },
	{ display_name: "Makerere University", country_code: "UG" },
	{ display_name: "Addis Ababa University", country_code: "ET" },
	{ display_name: "University of Ghana", country_code: "GH" },
	{ display_name: "BRAC University", country_code: "BD" },
	{ display_name: "Lahore University of Management Sciences", country_code: "PK" },
	{ display_name: "World Bank", country_code: "US" },
	{ display_name: "Research on Improving Systems of Education (RISE) Programme", country_code: "GB" },
];
const JOURNALS = ["Comparative Education Review", "International Journal of Educational Development", "Journal of Development Economics", "Education Sciences", "Compare: A Journal of Comparative and International Education", "Journal of Research on Educational Effectiveness"];
const PUBLISHERS = ["World Bank", "UNESCO", "RISE Programme", "EdTech Hub", "Oxford University Press", "Routledge", "J-PAL"];
const TYPES = ["JournalArticle", "JournalArticle", "JournalArticle", "JournalArticle", "Report", "Report", "Book", "BookSection", "ConferencePaper", "Thesis", "Document"];
const SENTENCES = [
	"We study how a structured lesson programme changed what children could read after two years.",
	"Teachers received scripted lesson guides, coaching visits every month and books for every pupil.",
	"Learning gains were largest for the children who started furthest behind.",
	"The programme cost less than ten dollars per child per year at scale.",
	"Effects faded when coaching visits stopped, which points to the role of continued support.",
	"We draw on classroom observations, assessment data and interviews with head teachers.",
	"Results differ by region, language of instruction and the size of the class.",
	"This review brings together evidence from forty-two studies in twenty-three countries.",
];

const sql = (value: string | null) => (value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`);
const json = (value: unknown) => `${sql(JSON.stringify(value))}::jsonb`;

function title(index: number) {
	if (index % 9 === 0) return pick(SHORT_TITLES);
	const base = `Effects of ${pick(TOPICS)} on learning in ${pick(PLACES)}: ${pick(DESIGNS)}`;
	// Every seventh title runs long, the way report titles do.
	return index % 7 === 0 ? `${base}, with follow-up of the same pupils three years later and a comparison with ${pick(TOPICS)} in ${pick(PLACES)}` : base;
}

/** `value()` with this chance, otherwise `otherwise`. */
const maybe = <T, U>(chance: number, value: () => T, otherwise: U): T | U => (next() < chance ? value() : otherwise);

function creators() {
	const count = maybe(0.1, () => between(8, 14), 0) || between(1, 4);
	return Array.from({ length: count }, () => ({
		creatorType: "author",
		firstName: pick(FIRST),
		lastName: pick(LAST),
		institutions: maybe(0.8, () => [pick(INSTITUTIONS), ...maybe(0.2, () => [pick(INSTITUTIONS)], [])], []),
	}));
}

const SEED_ITEM_COUNT = 80;

const COLLECTIONS = [
	{ key: key("VC", 1), name: "Foundational learning", parent: null },
	{ key: key("VC", 2), name: "Teachers and teaching", parent: null },
	{ key: key("VC", 3), name: "Coaching", parent: key("VC", 2) },
	{ key: key("VC", 4), name: "Girls' education", parent: null },
	{ key: key("VC", 5), name: "Education technology in low-connectivity settings", parent: null },
	{ key: key("VC", 6), name: "Cost-effectiveness", parent: null },
];

const pad = (value: number, length: number) => String(value).padStart(length, "0");

function itemDate() {
	const year = between(2005, 2026);
	return maybe(0.5, () => `${year}-${pad(between(1, 12), 2)}-${pad(between(1, 28), 2)}`, String(year));
}

/** Where a record was published: a journal for an article, a publisher for anything else. */
function venue(itemType: string) {
	const journal = itemType === "JournalArticle";
	return { journal: journal ? pick(JOURNALS) : null, publisher: journal ? null : pick(PUBLISHERS) };
}

function itemRow(itemKey: string, index: number) {
	const itemType = pick(TYPES);
	const { journal, publisher } = venue(itemType);
	const doi = maybe(0.7, () => `10.5555/verify.${index}`, null);
	const values = [
		sql(itemKey),
		"'native'",
		sql(itemKey),
		sql(itemType),
		"1",
		sql(title(index)),
		sql(maybe(0.8, () => Array.from({ length: between(1, 8) }, () => pick(SENTENCES)).join(" "), null)),
		sql(itemDate()),
		json(creators()),
		sql(journal),
		sql(publisher),
		sql(doi),
		sql(doi === null ? `https://example.org/verify/${index}` : null),
		maybe(0.6, () => `ARRAY[${sql(pick(PLACES))}]::varchar[]`, "NULL"),
		sql(maybe(0.15, () => pick(["French", "Swahili", "Portuguese"]), "English")),
		`timestamp '2026-09-01 00:00:00' - interval '${index} days'`,
		"0",
	];
	return `INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision", "title", "abstractNote", "date", "creators", "publicationTitle", "publisher", "DOI", "url", "countryFocus", "languageName", "dateAdded", "deleted") VALUES (${values.join(", ")});`;
}

// Citation counts come from OpenAlex, through the source connection the fixture database already has.
function citationRows(itemKey: string, index: number): string[] {
	const cited = between(0, maybe(0.1, () => 2400, 120));
	return [
		`INSERT INTO "itemSourceLink" ("itemKey", "sourceConnectionKey", "sourceRecordKey") VALUES (${sql(itemKey)}, 'openalex-acceptance', ${sql(`W9${pad(index, 8)}`)});`,
		`INSERT INTO "itemCitationMetric" ("itemKey", "sourceConnectionKey", "citedByCount", "referencedWorksCount", "observedAt") VALUES (${sql(itemKey)}, 'openalex-acceptance', ${cited}, ${between(5, 80)}, '2026-09-01T00:00:00Z');`,
	];
}

const outboxRow = (entityType: string, entityKey: string) => `INSERT INTO "outbox" ("entityType", "entityKey", "operation", "revision") VALUES ('${entityType}', ${sql(entityKey)}, 'upsert', 1);`;

function itemRows(index: number, members: Map<string, string[]>): string[] {
	const itemKey = key("V", index);
	const rows = [`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES (${sql(itemKey)}, 'native', ${sql(itemKey)});`, itemRow(itemKey, index)];
	rows.push(...maybe(0.65, () => citationRows(itemKey, index), []));
	for (const collection of COLLECTIONS) members.get(collection.key)!.push(...maybe(0.25, () => [itemKey], []));
	return [...rows, outboxRow("item", itemKey)];
}

function collectionRows(collection: (typeof COLLECTIONS)[number], index: number, items: string[]): string[] {
	const children = COLLECTIONS.filter((other) => other.parent === collection.key).length;
	return [
		`INSERT INTO "collection" ("key", "sourceConnectionKey", "sourceRecordKey", "name", "numItems", "numCollections", "sortOrder", "parentCollection") VALUES (${sql(collection.key)}, 'native', ${sql(collection.key)}, ${sql(collection.name)}, ${items.length}, ${children}, ${(index + 10) * 1024}, ${sql(collection.parent)});`,
		...items.map((itemKey) => `INSERT INTO "itemToCollection" ("itemKey", "collectionKey") VALUES (${sql(itemKey)}, ${sql(collection.key)});`),
		outboxRow("collection", collection.key),
	];
}

function digestRow(week: number): string {
	const start = new Date(Date.UTC(2026, 7, 3 + week * 7));
	const end = new Date(start.getTime() + 7 * 86_400_000);
	const topic = TOPICS[week % TOPICS.length];
	const markdown = `## ${topic[0].toUpperCase()}${topic.slice(1)}\n\n${Array.from({ length: between(2, 5) }, () => pick(SENTENCES)).join(" ")}\n\n## What it means for schools\n\n${pick(SENTENCES)}`;
	const values = [
		sql(`00000000-0000-4000-8000-${pad(week, 12)}`),
		"'digest'",
		sql(start.toISOString()),
		sql(end.toISOString()),
		"'[]'",
		sql(`New evidence on ${topic}`),
		sql(`Studies this week on **${topic}** and what they mean for classrooms.`),
		sql(markdown),
		sql(end.toISOString()),
		"NULL",
	];
	return `INSERT INTO "notificationEdition" ("id", "stream", "windowStart", "windowEnd", "publications", "title", "summary", "markdown", "publishedAt", "nextAttemptAt") VALUES (${values.join(", ")});`;
}

export function seedSql(): string {
	const members = new Map<string, string[]>(COLLECTIONS.map((collection) => [collection.key, []]));
	const statements = COLLECTIONS.map((collection) => `INSERT INTO "collectionIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES (${sql(collection.key)}, 'native', ${sql(collection.key)});`);
	for (let index = 1; index <= SEED_ITEM_COUNT; index++) statements.push(...itemRows(index, members));
	COLLECTIONS.forEach((collection, index) => statements.push(...collectionRows(collection, index, members.get(collection.key)!)));
	for (let week = 1; week <= 6; week++) statements.push(digestRow(week));
	statements.push(
		`UPDATE "status" SET "totalRecords" = (SELECT count(*) FROM "item" WHERE "deleted" = 0), "totalItems" = (SELECT count(*) FROM "item" WHERE "deleted" = 0 AND "parentItem" IS NULL), "databaseUpdatedAt" = '2026-09-01T00:00:00Z' WHERE "id" = 1;`,
	);
	return `BEGIN;\n${statements.join("\n")}\nCOMMIT;\n`;
}
