import type { AIHistory } from "@/types/ai";

export function upsertAIHistory(history: AIHistory[], entry: AIHistory) {
	return [entry, ...history.filter((item) => item.id !== entry.id)];
}
