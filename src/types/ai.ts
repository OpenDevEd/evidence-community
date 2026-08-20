import type { AIModelId } from "@/lib/ai/models";

export type AIHistory = {
	id: string;
	title: string;
	key: string;
	content: string;
	date: Date;
	modelId: AIModelId;
};
