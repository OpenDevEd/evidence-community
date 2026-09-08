import { describe, expect, it } from "vitest";
import { rebaseWorkingDraftAfterReview } from "@/lib/admin/review-draft-rebase";

const submitted = { itemType: "Report", title: "Submitted title", abstractNote: "Submitted abstract" };

describe("working draft after review", () => {
  it("applies Editor corrections when the Creator has not changed those fields", () => {
    const result = rebaseWorkingDraftAfterReview({ submitted, approved: { ...submitted, title: "Corrected title" }, working: { ...submitted, abstractNote: "New draft abstract" } });
    expect(result.payload).toMatchObject({ title: "Corrected title", abstractNote: "New draft abstract" });
    expect(result.conflicts).toEqual([]);
  });
  it("keeps conflicting newer edits private and identifies the field for resolution", () => {
    const result = rebaseWorkingDraftAfterReview({ submitted, approved: { ...submitted, title: "Editor title" }, working: { ...submitted, title: "Creator title" } });
    expect(result.payload).toMatchObject({ title: "Creator title" });
    expect(result.conflicts).toEqual(["title"]);
  });
  it("does not conflict when both people made the same correction", () => {
    const result = rebaseWorkingDraftAfterReview({ submitted, approved: { ...submitted, title: "Corrected title" }, working: { ...submitted, title: "Corrected title" } });
    expect(result.payload).toMatchObject({ title: "Corrected title" });
    expect(result.conflicts).toEqual([]);
  });
});
