import { describeZoteroItemTypeFields } from "@opendeved/evidence-library-core/zotero-schema";
import { humanizeAdminField } from "@/components/admin/admin-schema";
import { canonicalItemTypeToZotero } from "@/lib/item-field-codec";

type Provider = "Crossref" | "Zenodo";
type ProviderIssue = { readonly code: string; readonly path: string };

/** A DOI provider's check on a record as the editor field it concerns and a sentence naming the provider, what it needs and that the DOI depends on it. */
export function describeProviderIssue(
	provider: Provider,
	issue: ProviderIssue,
	itemType: string,
) {
	const raw = issue.path.replace(/^fields\./u, "").split(".")[0] ?? "";
	const semantic =
		(
			{
				publicationDate: "date",
				abstract: "abstractNote",
				institution: "publisher",
			} as Record<string, string>
		)[raw] ?? raw;
	const field =
		describeZoteroItemTypeFields(canonicalItemTypeToZotero(itemType)).find(
			(entry) => entry.field === semantic || entry.semanticField === semantic,
		)?.field ?? semantic;
	return { field, text: issueText(provider, issue, field) };
}

const DEPENDS_ON = "to register the DOI.";

/** Checks whose sentence doesn't depend on the field's label, by the provider's issue path. */
const PATH_TEXT: readonly (readonly [RegExp, (provider: Provider) => string])[] = [
	[/^itemType$/u, (provider) => `${provider} can't register a DOI for this item type. Change the item type${provider === "Crossref" ? " or choose Zenodo as the DOI provider" : ""}.`],
	[/^publicationDate$/u, (provider) => provider === "Zenodo" ? `Zenodo needs a full publication date, with day, month and year, ${DEPENDS_ON}` : `Crossref needs a real publication date ${DEPENDS_ON}`],
	[/^title$/u, (provider) => `${provider} needs a title of at least 3 characters ${DEPENDS_ON}`],
	[/^creators$/u, (provider) => `${provider} needs at least one author ${DEPENDS_ON}`],
	[/^creators\.\d+\.orcid$/u, (provider) => `${provider} needs a valid 16-character ORCID iD for every author that has one, ${DEPENDS_ON}`],
	[/^creators\.\d+$/u, (provider) => `${provider} needs a name for every author ${DEPENDS_ON}`],
	[/^language$/u, (provider) => `${provider} needs the language as an ISO 639 code, such as en, ${DEPENDS_ON}`],
	[/^license$/u, () => `Zenodo doesn't accept this licence. Choose another licence ${DEPENDS_ON}`],
	[/^identifiers\./u, (provider) => `${provider} can't use this library's DOI prefix. Check the library's DOI settings.`],
];

function issueText(provider: Provider, { code, path }: ProviderIssue, field: string) {
	const fixed = PATH_TEXT.find(([pattern]) => pattern.test(path))?.[1];
	if (fixed) return fixed(provider);
	const label = humanizeAdminField(field)
		.split(" ")
		.map((word) => (/^[A-Z]+$/u.test(word) ? word : word.toLowerCase()))
		.join(" ");
	if (code !== "MISSING_REQUIRED_FIELD") return `${provider} needs a valid ${label} ${DEPENDS_ON}`;
	const article = /^(?!uni|use)[aeiou]/u.test(label) ? "an" : "a";
	return `${provider} needs ${article} ${label} ${DEPENDS_ON}${provider === "Crossref" ? " Add it, or choose Zenodo as the DOI provider." : ""}`;
}
