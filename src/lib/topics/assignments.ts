import { z } from "zod";
import { topicIdSchema } from "./contract";

const sourceId = z.string().transform(value => value.replace(/^https?:\/\/openalex\.org\//, "")).pipe(topicIdSchema);
const assignmentSchema = z.object({id: sourceId, score: z.number().min(0).max(1)});
const workSchema = z.object({
  topics: z.array(z.unknown()).nullish().catch(null),
  primary_topic: z.object({id: sourceId}).nullish().catch(null),
});

/** A malformed entry is dropped so one bad topic cannot stop a whole source page. */
export function importedTopics(raw: unknown) {
  const data = workSchema.parse(raw);
  const topics = (data.topics ?? []).flatMap(entry => {
    const topic = assignmentSchema.safeParse(entry);
    return topic.success ? [topic.data] : [];
  }).slice(0, 100);
  return [...new Map(topics.map(topic => [topic.id, {
    topicId: topic.id, score: topic.score, primary: data.primary_topic?.id === topic.id,
  }])).values()];
}

export function effectiveSourceTopics(assignments: ReturnType<typeof importedTopics>) {
  return assignments.filter(topic => topic.score >= 0.5).map(topic => topic.topicId).sort();
}
