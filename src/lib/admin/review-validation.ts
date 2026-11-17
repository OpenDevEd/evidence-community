import {
	validateCrossrefPublicationRecord,
	validateZenodoPublicationRecord,
} from "@opendeved/doi-sync-core/metadata";
import { publicationRecordMetadata } from "@/lib/publication/record-metadata";
import { describeProviderIssue } from "@/lib/publication/provider-issue";
import { licenceComplete } from "@/lib/licences";
import { AdminValidationError, type AdminFieldErrors } from "./errors";
import { inspectNativeItemDraft } from "./native-item-validation";
import type { PublishingChoice } from "./review-contract";

/** The submitted payload and the live form use the same provider metadata rules. */
export function validateReviewPayload(
	payload: unknown,
	choice: PublishingChoice | null,
) {
	const inspected = inspectNativeItemDraft(payload, {
		requireTitle: !choice,
	});
	const { value: validated, fields } = inspected;
	if (!validated || !choice) {
		if (!validated || Object.keys(fields).length)
			throw new AdminValidationError(inspected.message, fields);
		return validated;
	}
	const item = validated.item;
	const metadata = reviewMetadata(validated);
	const issues = [
		...validateZenodoPublicationRecord(metadata).map(
			(issue) => ["Zenodo", issue] as const,
		),
		...(choice.route === "crossref-zenodo"
			? validateCrossrefPublicationRecord(metadata).map(
					(issue) => ["Crossref", issue] as const,
				)
			: []),
	];
	// A DOI goes out under the record's own licence, which Zenodo and Crossref both take.
	if (!licenceComplete(item.licence)) fields.licence ??= item.licence ? "Give this licence its name and a link to its terms." : "Pick a licence. A DOI needs one.";
	for (const [provider, issue] of issues) {
		const { field, text } = describeProviderIssue(
			provider,
			issue,
			item.itemType,
		);
		fields[field] ??= text;
	}
	if (Object.keys(fields).length)
		throw new AdminValidationError(
			"Complete the publishing requirements before submitting.",
			fields,
		);
	return validated;
}

/** What publishing needs, a sentence each, in the words of the record editor's Review requirements, which name the field. */
export const needsText = (needs: AdminFieldErrors) => `${Object.values(needs).map((text) => text.replace(/\.$/u, "")).join(". ")}.`;

/** What the record still needs before it can publish with this choice, by field, in the words the record editor's Review requirements show; empty when nothing. */
export function publishingNeeds(
	payload: unknown,
	choice: PublishingChoice | null,
): AdminFieldErrors {
	try {
		validateReviewPayload(payload, choice);
		return {};
	} catch (error) {
		return error instanceof AdminValidationError
			? error.fields
			: { _form: "Check the item details." };
	}
}

function reviewMetadata(
	validated: NonNullable<ReturnType<typeof inspectNativeItemDraft>["value"]>,
) {
	const item = validated.item;
	try {
		return publicationRecordMetadata(
			metadataInput(item),
			validated.tags,
			licenceComplete(item.licence) ? item.licence : null,
		);
	} catch (error) {
		throw new AdminValidationError("Check the creator details.", {
			creators:
				error instanceof Error
					? error.message
					: "Check the creator names.",
		});
	}
}

function metadataInput(
	item: NonNullable<
		ReturnType<typeof inspectNativeItemDraft>["value"]
	>["item"],
) {
	return {
		...item,
		title: item.title ?? null,
		date: item.date ?? null,
		abstractNote: item.abstractNote ?? null,
		languageName: item.languageName ?? null,
		publisher: item.publisher ?? null,
		rights: item.rights ?? null,
		creators: item.creators ?? [],
	};
}
