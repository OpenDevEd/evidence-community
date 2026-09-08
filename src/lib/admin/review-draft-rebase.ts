import { mergeConcurrentDraftEdits, rebaseNativeItemDraftPayload } from "./item-draft-rebase";

/** Publishing an approved snapshot must preserve edits made after submission. */
export function rebaseWorkingDraftAfterReview({ submitted, approved, working }: {
  submitted: unknown;
  approved: unknown;
  working: unknown;
}) {
  const merged = mergeConcurrentDraftEdits({ currentPayload: approved, expectedPayload: submitted, payload: working });
  return {
    payload: merged.kind === "merged" ? merged.payload : rebaseNativeItemDraftPayload({ currentPayload: approved, expectedPayload: submitted, payload: working }).payload,
    conflicts: merged.kind === "conflict" ? merged.fields : [],
  };
}
