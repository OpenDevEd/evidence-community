import { describe, expect, it } from "vitest";
import { changesBetween, editCount } from "@/components/admin/digest-changes";

const kinds = (before: string, after: string) => changesBetween(before, after).filter(part => part.kind !== "same").map(part => [part.kind, part.text.trim()]);

describe("what a person changed in a digest's text", () => {
  it("marks nothing when the text is as AI wrote it, whatever space surrounds it", () => {
    const text = "## Reading\n\nA study of reading [Mills, 2026](/lib/ABCD2345).";
    expect(kinds(text, `${text}\n`)).toEqual([]);
    expect(editCount(changesBetween(text, `\n${text}  `))).toBe(0);
  });

  it("shows a reworded phrase as what was removed, then what replaced it, and counts it once", () => {
    const parts = changesBetween("The larger losses fall in storage.", "Most of the losses happen in storage.");
    expect(parts.filter(part => part.kind !== "same").map(part => [part.kind, part.text.trim()])).toEqual([
      ["removed", "The"], ["removed", "larger"], ["added", "Most"], ["added", "of"], ["added", "the"], ["removed", "fall"], ["added", "happen"],
    ]);
    expect(editCount(parts)).toBe(2);
    // Words both texts share keep the space after them, so a removed run never touches the word before it.
    expect(parts.map(part => part.text).join("")).toContain("losses fall happen in storage.");
  });

  it("treats a citation and a bold lead-in as one word each", () => {
    expect(kinds("See [Mills, 2026](/lib/ABCD2345).", "See [Okoro and Adu, 2026](/lib/WXYZ6789).")).toEqual([
      ["removed", "[Mills, 2026](/lib/ABCD2345)"], ["added", "[Okoro and Adu, 2026](/lib/WXYZ6789)"],
    ]);
    expect(kinds("**Viet Nam.** A study.", "**Kenya.** A study.")).toEqual([["removed", "**Viet Nam.**"], ["added", "**Kenya.**"]]);
  });

  it("counts a paragraph that was taken out or put in as one edit", () => {
    const before = "## Heat\n\nParks cooled their surroundings.\n\nDense blocks ran hotter.";
    expect(editCount(changesBetween(before, "## Heat\n\nDense blocks ran hotter."))).toBe(1);
    expect(editCount(changesBetween("## Heat\n\nDense blocks ran hotter.", before))).toBe(1);
    // Two changes with untouched text between them are two edits.
    expect(editCount(changesBetween(before, "## Heat\n\nParks cooled the streets around them.\n\nDense blocks ran much hotter."))).toBe(2);
  });
});
