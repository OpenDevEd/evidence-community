import { describe, expect, it } from "vitest";
import { importedTopics, effectiveSourceTopics } from "../../src/lib/topics/assignments";

describe("source topic assignments", () => {
  it("retains low scores privately while publishing the accepted cutoff", () => {
    const raw = {primary_topic: {id: "https://openalex.org/T12260"}, topics: [
      {id: "https://openalex.org/T12260", score: 0.5}, {id: "T99", score: 0.49},
    ]};
    expect(importedTopics(raw)).toEqual([{topicId: "T12260", score: 0.5, primary: true}, {topicId: "T99", score: 0.49, primary: false}]);
    expect(effectiveSourceTopics(importedTopics(raw))).toEqual(["T12260"]);
  });
  it("rejects malformed assignments instead of guessing identifiers or scores", () => {
    expect(() => importedTopics({topics: [{id: "made up", score: 1}]})).toThrow();
    expect(() => importedTopics({topics: [{id: "T1", score: 1.1}]})).toThrow();
  });
});
