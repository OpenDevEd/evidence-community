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
