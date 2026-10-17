import { describeZoteroItemTypeFields } from "@opendeved/evidence-library-core/zotero-schema";
import { humanizeAdminField } from "@/components/admin/admin-schema";
import { canonicalItemTypeToZotero } from "@/lib/item-field-codec";

type Provider = "Crossref" | "Zenodo";
type ProviderIssue = {
	readonly code: string;
	readonly path: string;
	readonly message: string;
};

/** Provider paths named differently from the record's fields. */
const PATH_ALIASES: Record<string, string> = {
	publicationDate: "date",
	abstract: "abstractNote",
	institution: "publisher",
	version: "versionNumber",
};

/** A DOI provider's check on a record as the editor field it concerns and a sentence naming the provider, what it needs and that the DOI depends on it. */
export function describeProviderIssue(
	provider: Provider,
	issue: ProviderIssue,
	itemType: string,
) {
	const path = issue.path.replace(/^fields\./u, "");
	const descriptors = describeZoteroItemTypeFields(
		canonicalItemTypeToZotero(itemType),
	);
	const fieldOf = (name: string) =>
		descriptors.find(
			(entry) => entry.field === name || entry.semanticField === name,
		)?.field ?? name;
	const head = path.split(".")[0] ?? path;
	return {
		field: fieldOf(PATH_ALIASES[path] ?? path),
		text: issueText(provider, issue, path, fieldOf(PATH_ALIASES[head] ?? head)),
	};
}

const DEPENDS_ON = "to register the DOI.";
const OR_ZENODO = " or choose Zenodo as the DOI provider";

/** Checks whose sentence doesn't depend on the field's label, by the provider's issue path without its `fields.` prefix. */
const PATH_TEXT: readonly (readonly [RegExp, (provider: Provider) => string])[] = [
	[/^(itemType|postedContentConfirmed)$/u, (provider) => `${provider} can't register a DOI for this item type. Change the item type${provider === "Crossref" ? OR_ZENODO : ""}.`],
	[/^presentationType$/u, () => `Crossref registers a DOI for a presentation only when its presentation type is poster. Change it${OR_ZENODO}.`],
	[/^publicationDate$/u, (provider) => provider === "Zenodo" ? `Zenodo needs a full publication date, with day, month and year, ${DEPENDS_ON}` : `Crossref needs a publication date with a year from 1400 to 2200 ${DEPENDS_ON}`],
	[/^title$/u, (provider) => `${provider} needs a title of at least 3 characters ${DEPENDS_ON}`],
	[/^creators$/u, (provider) => `${provider} needs at least one creator ${DEPENDS_ON}`],
	[/^creators\.\d+\.orcid$/u, (provider) => `${provider} needs a valid 16-character ORCID iD for every creator that has one, ${DEPENDS_ON}`],
	[/^creators\.\d+$/u, (provider) => `${provider} needs a name for every creator ${DEPENDS_ON}`],
	[/^language$/u, (provider) => `${provider} needs the language as an ISO 639 code, such as en, ${DEPENDS_ON}`],
	[/^license$/u, () => `Zenodo doesn't accept this licence. Choose another licence ${DEPENDS_ON}`],
	[/^identifiers\./u, (provider) => `${provider} can't use this library's DOI prefix. Check the library's DOI settings.`],
];

function issueText(
	provider: Provider,
	{ code, message }: ProviderIssue,
	path: string,
	field: string,
) {
	const fixed = PATH_TEXT.find(([pattern]) => pattern.test(path))?.[1];
	if (fixed) return fixed(provider);
	const label = humanizeAdminField(field)
		.split(" ")
		.map((word) => (/^[A-Z]+$/u.test(word) ? word : word.toLowerCase()))
		.join(" ");
	const length = /(\d+)-(\d+) characters/u.exec(message);
	if (length)
		return `${provider} needs the ${label} to be ${length[1]} to ${length[2]} characters ${DEPENDS_ON}`;
	if (code !== "MISSING_REQUIRED_FIELD")
		return `${provider} needs a valid ${label} ${DEPENDS_ON}`;
	const article = /^(?!uni|use)[aeiou]/u.test(label) ? "an" : "a";
	return `${provider} needs ${article} ${label} ${DEPENDS_ON}${provider === "Crossref" ? ` Add it,${OR_ZENODO}.` : ""}`;
}
