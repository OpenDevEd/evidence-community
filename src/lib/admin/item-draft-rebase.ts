import {
	applyItemDraftPatch,
	createItemDraftPatch,
} from "./item-draft-merge";
import { validateNativeItemDraft } from "./native-item-validation";

const draftValidationOptions = { allowIncompleteCreators: true } as const;

export function rebaseNativeItemDraftPayload({
	currentPayload,
	expectedPayload,
	payload,
}: {
	currentPayload: unknown;
	expectedPayload: unknown;
	payload: unknown;
}) {
	const current = validateNativeItemDraft(
		currentPayload,
		draftValidationOptions,
	);
	const expected = validateNativeItemDraft(
		expectedPayload,
		draftValidationOptions,
	);
	const submitted = validateNativeItemDraft(payload, draftValidationOptions);
	const editorChanges = createItemDraftPatch(
		expected.payload,
		submitted.payload,
	);
	return validateNativeItemDraft(
		applyItemDraftPatch(current.payload, editorChanges),
		draftValidationOptions,
	);
}

export type ConcurrentDraftMerge =
	| { kind: "conflict"; fields: string[] }
	| { kind: "merged"; payload: Record<string, unknown> };

/**
 * Merges one editor's changes into a draft that another session changed
 * after this editor loaded it (for example a second browser tab).
 *
 * "What this editor changed" is the difference between what they loaded
 * (`expectedPayload`) and what they sent (`payload`). "What the other session
 * changed" is the difference between what this editor loaded and the draft
 * as it is now (`currentPayload`). If the two sets of changed fields do not
 * overlap, both are kept. A field changed on both sides to the same value is
 * fine. A field changed on both sides to different values is a conflict, and
 * nothing is saved.
 */
export function mergeConcurrentDraftEdits({
	currentPayload,
	expectedPayload,
	payload,
}: {
	currentPayload: unknown;
	expectedPayload: unknown;
	payload: unknown;
}): ConcurrentDraftMerge {
	const current = validateNativeItemDraft(
		currentPayload,
		draftValidationOptions,
	).payload;
	const expected = validateNativeItemDraft(
		expectedPayload,
		draftValidationOptions,
	).payload;
	const submitted = validateNativeItemDraft(
		payload,
		draftValidationOptions,
	).payload;
	const editorChanges = createItemDraftPatch(expected, submitted);
	const otherChanges = createItemDraftPatch(expected, current);
	const fields = Object.keys(editorChanges)
		.filter((field) => Object.hasOwn(otherChanges, field))
		.filter(
			(field) =>
				JSON.stringify(editorChanges[field]) !==
				JSON.stringify(otherChanges[field]),
		)
		.sort();
	if (fields.length > 0) return { kind: "conflict", fields };
	return {
		kind: "merged",
		payload: applyItemDraftPatch(current, editorChanges),
	};
}
