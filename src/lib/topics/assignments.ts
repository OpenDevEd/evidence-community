import { z } from "zod";
import { topicIdSchema } from "./contract";

const sourceId = z.string().transform(value => value.replace(/^https?:\/\/openalex\.org\//, "")).pipe(topicIdSchema);
const assignmentsSchema = z.object({
  topics: z.array(z.object({id: sourceId, score: z.number().min(0).max(1)})).max(100).nullish(),
  primary_topic: z.object({id: sourceId}).nullish(),
});

export function importedTopics(raw: unknown) {
  const data = assignmentsSchema.parse(raw);
  return [...new Map((data.topics ?? []).map(topic => [topic.id, {
    topicId: topic.id, score: topic.score, primary: data.primary_topic?.id === topic.id,
  }])).values()];
}

export function effectiveSourceTopics(assignments: ReturnType<typeof importedTopics>) {
  return assignments.filter(topic => topic.score >= 0.5).map(topic => topic.topicId).sort();
}
