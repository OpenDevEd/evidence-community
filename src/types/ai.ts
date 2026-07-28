import type { AIProviderId } from "@/lib/ai-provider-factory";

export type AIHistory = {
	id: string;
	title: string;
	key: string;
	content: string;
	date: Date;
	provider: AIProviderId;
}
