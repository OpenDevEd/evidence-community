import {
	validateCrossrefPublicationRecord,
	validateZenodoPublicationRecord,
} from "@opendeved/doi-sync-core/metadata";
import { describeZoteroItemTypeFields } from "@opendeved/evidence-library-core/zotero-schema";
import { publicationRecordMetadata } from "@/lib/publication/record-metadata";
import { canonicalItemTypeToZotero } from "@/lib/item-field-codec";
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
		...validateZenodoPublicationRecord(metadata),
		...(choice.route === "crossref-zenodo"
			? validateCrossrefPublicationRecord(metadata)
			: []),
	];
	const descriptors = describeZoteroItemTypeFields(
		canonicalItemTypeToZotero(item.itemType),
	);
	for (const issue of issues) {
		const raw = issue.path.replace(/^fields\./u, "");
		const field =
			(
				{
					publicationDate: "date",
					abstract: "abstractNote",
					institution: "publisher",
				} as Record<string, string>
			)[raw] ?? raw;
		const descriptor = descriptors.find(
			(entry) => entry.field === field || entry.semanticField === field,
		);
		const path = descriptor?.field ?? field;
		fields[path] ??=
			raw === "publicationDate"
				? "Enter a valid publication date."
				: issue.message;
	}
	if (Object.keys(fields).length)
		throw new AdminValidationError(
			"Complete the publishing requirements before submitting.",
			fields,
		);
	return validated;
}

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
			"",
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
