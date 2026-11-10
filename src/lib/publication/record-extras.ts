import { and, eq, inArray } from "drizzle-orm";
import { institutionNameKey } from "@/config/library-config/institutions";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { institutionCountry } from "@/db/schema/tables/institutionCountry";
import { item } from "@/db/schema/tables/item";
import { itemLink } from "@/db/schema/tables/itemLink";
import { itemToTag } from "@/db/schema/tables/itemToTag";
import { resolveCountryFocus } from "@/lib/country-focus";
import { readStudyReading } from "@/lib/readings/reading";
import { resolveTopicNodes } from "@/lib/topics/catalog";
import { resolveBibliographicDoi } from "./bibliographic-doi";
import type { PublicationRepositorySnapshot } from "./repository";

/**
 * What a record's deposit carries beyond its own row (OpenDevEd/openalex-count plans/registrar-metadata): the records
 * it cites and relates to, by their DOIs, its topics by name, the ROR of each institution its creators name, and the
 * published file's address and type.
 */
export type PublicationRecordExtras = {
	links: readonly { kind: "cites" | "related"; key: string; doi: string | null }[];
	topicNames: readonly string[];
	/** The study type and the countries as readers see them: an editor's choice, else what was read from the record. */
	studyType?: string;
	countries: readonly string[];
	/** What is known of each institution the creators name, by its `institutionNameKey`: its ROR and its country. */
	institutions: Readonly<Record<string, InstitutionFacts>>;
	fullTextUrl?: string;
	formats: readonly string[];
};

export type InstitutionFacts = { ror?: string; country?: string };

export type PublicationExtrasConfig = Pick<LibraryServerConfig, "identity" | "services"> &
	Partial<Pick<LibraryServerConfig, "topics" | "authentication">>;

/** An OpenAlex ID as one short key, however it was kept. */
const openAlexKey = (id: string) => id.replace(/^https?:\/\/openalex\.org\//i, "").toUpperCase();

const OPENALEX_IDS_PER_REQUEST = 50;

export async function loadPublicationRecordExtras(
	database: Database,
	snapshot: PublicationRepositorySnapshot,
	config: PublicationExtrasConfig,
	request: typeof fetch = fetch,
): Promise<PublicationRecordExtras> {
	const record = snapshot.record;
	if (!record) return { links: [], topicNames: [], countries: [], institutions: {}, formats: [] };
	// The records this one cites, and the ones related to it whichever way the link was made: related is both ways.
	const outgoing = await database
		.select({ kind: itemLink.kind, key: itemLink.toKey, DOI: item.DOI, extra: item.extra })
		.from(itemLink)
		.innerJoin(item, eq(item.key, itemLink.toKey))
		.where(and(eq(itemLink.fromKey, record.key), inArray(itemLink.kind, ["cites", "related"])));
	const incoming = await database
		.select({ kind: itemLink.kind, key: itemLink.fromKey, DOI: item.DOI, extra: item.extra })
		.from(itemLink)
		.innerJoin(item, eq(item.key, itemLink.fromKey))
		.where(and(eq(itemLink.toKey, record.key), eq(itemLink.kind, "related")));
	const links = [...outgoing, ...incoming].filter((link, index, all) => all.findIndex((other) => other.kind === link.kind && other.key === link.key) === index);
	const reading = record.studyType ? null : await readStudyReading(database, record.key);
	// Topics are named by the catalog the library reads them from.
	const topicNames =
		config.topics?.enabled && config.authentication && record.topics.length
			? (await resolveTopicNodes(record.topics, { database, config: { authentication: config.authentication }, fetch: request }, { allowUnknown: true })).map((node) => node.name)
			: [];
	const pdf = snapshot.files.find((file) => file.contentType === "application/pdf");
	return {
		// A linked record's DOI wherever it keeps one: its DOI field, its Extra, or an attachment tagged as its DOI.
		links: await linkedDois(database, links),
		topicNames: [...new Set(topicNames)].sort(),
		...((record.studyType ?? reading?.type) ? { studyType: (record.studyType ?? reading?.type)! } : {}),
		countries: resolveCountryFocus({ title: record.title, abstractNote: record.abstractNote, countryFocus: record.countryFocus }),
		institutions: await institutionFacts(database, record.creators ?? [], config.services.openAlex?.apiKey, request),
		...(pdf ? { fullTextUrl: new URL(`/api/item/${record.key}/download/${pdf.itemKey}`, config.identity.baseUrl).toString() } : {}),
		formats: [...new Set(snapshot.files.map((file) => file.contentType))].sort(),
	};
}

/** Each linked record with its DOI, read as the record's own is (`resolveBibliographicDoi`), attachments included. */
async function linkedDois(
	database: Database,
	links: readonly { kind: "cites" | "related"; key: string; DOI: string | null; extra: string | null }[],
): Promise<PublicationRecordExtras["links"]> {
	const attachments = links.length
		? await database
				.select({ parentItem: item.parentItem, url: item.url, tag: itemToTag.tagName })
				.from(item)
				.innerJoin(itemToTag, eq(itemToTag.itemKey, item.key))
				.where(and(inArray(item.parentItem, [...new Set(links.map((link) => link.key))]), eq(item.deleted, 0)))
		: [];
	return links.map((link) => ({
		kind: link.kind,
		key: link.key,
		doi: resolveBibliographicDoi({
			DOI: link.DOI,
			extra: link.extra,
			attachments: attachments.filter((attachment) => attachment.parentItem === link.key).map(({ url, tag }) => ({ url, tags: [tag] })),
		}).doi,
	}));
}

type NamedInstitution = { key: string; id?: string; country?: string };
type InstitutionCreator = { institution?: string | null; institutions?: readonly { id?: string | null; display_name?: string | null; country_code?: string | null }[] };

/** Each institution a creator names, with the OpenAlex ID and country it was given with, if any. */
function namedInstitutions(creator: InstitutionCreator): NamedInstitution[] {
	const listed = (creator.institutions ?? []).flatMap((institution) =>
		institution.display_name?.trim()
			? [{ key: institutionNameKey(institution.display_name), ...(institution.id ? { id: openAlexKey(institution.id) } : {}), ...(institution.country_code ? { country: institution.country_code } : {}) }]
			: [],
	);
	return creator.institution?.trim() ? [...listed, { key: institutionNameKey(creator.institution) }] : listed;
}

/** An institution with the OpenAlex ID and country the library keeps for its name where it wasn't given them. */
function withStored(institution: NamedInstitution, row: { countryCode: string; openalexId: string | null } | undefined): NamedInstitution {
	const id = institution.id ?? (row?.openalexId ? openAlexKey(row.openalexId) : undefined);
	const country = (institution.country ?? row?.countryCode)?.toUpperCase();
	return { key: institution.key, ...(id ? { id } : {}), ...(country ? { country } : {}) };
}

/** The OpenAlex ID and country the library keeps for each of these names. */
async function storedInstitutions(database: Database, named: readonly NamedInstitution[]) {
	const rows = await database
		.select({ nameKey: institutionCountry.nameKey, countryCode: institutionCountry.countryCode, openalexId: institutionCountry.openalexId })
		.from(institutionCountry)
		.where(inArray(institutionCountry.nameKey, [...new Set(named.map((institution) => institution.key))]));
	return new Map(rows.map((row) => [row.nameKey, row]));
}

/**
 * The ROR and country of each institution the creators name. A creator names it by its OpenAlex ID when it has one;
 * a record imported from OpenAlex keeps only names on its creators, and the library keeps each name's OpenAlex ID and
 * country in `institutionCountry`.
 */
async function institutionFacts(
	database: Database,
	creators: readonly InstitutionCreator[],
	apiKey: string | undefined,
	request: typeof fetch,
) {
	const named = creators.flatMap(namedInstitutions);
	if (!named.length) return {};
	const stored = await storedInstitutions(database, named);
	const facts: Record<string, InstitutionFacts> = {};
	const ids = new Map<string, string>();
	// The first mention of a name gives its ID and country; a later one fills only what is still missing.
	for (const { key, id, country } of named.map((institution) => withStored(institution, stored.get(institution.key)))) {
		if (id && !ids.has(key)) ids.set(key, id);
		facts[key] = { ...(country ? { country } : {}), ...facts[key] };
	}
	const rors = await openAlexRors([...new Set(ids.values())], apiKey, request);
	for (const [key, id] of ids) if (rors[id]) facts[key] = { ...facts[key], ror: rors[id] };
	return facts;
}

/** Each institution's ROR from OpenAlex, by its OpenAlex ID: one request per 50. */
async function openAlexRors(ids: readonly string[], apiKey: string | undefined, request: typeof fetch) {
	const rors: Record<string, string> = {};
	for (let at = 0; at < ids.length; at += OPENALEX_IDS_PER_REQUEST) {
		const url = new URL("https://api.openalex.org/institutions");
		url.searchParams.set("filter", `openalex:${ids.slice(at, at + OPENALEX_IDS_PER_REQUEST).join("|")}`);
		url.searchParams.set("select", "id,ids");
		url.searchParams.set("per-page", String(OPENALEX_IDS_PER_REQUEST));
		if (apiKey) url.searchParams.set("api_key", apiKey);
		const response = await request(url, { signal: AbortSignal.timeout(30_000) });
		// The deposit waits for what it would carry: the job tries again, as for a registrar that can't be reached.
		if (!response.ok) throw new Error(`OpenAlex answered ${response.status} when asked for the record's institutions`);
		const { results } = (await response.json()) as { results: { id: string; ids?: { ror?: string | null } }[] };
		for (const institution of results) if (institution.ids?.ror) rors[openAlexKey(institution.id)] = institution.ids.ror;
	}
	return rors;
}
