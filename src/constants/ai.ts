

import ChatGPT from "@/components/icons/ChatGPT";
import Gemini from "@/components/icons/Gemini";
import Claude from "@/components/icons/Claude";

export const models = [
	{
		name: "ChatGPT",
		company: "OpenAI",
        model: process.env.NEXT_PUBLIC_OPENAI_MODEL,
		icon: ChatGPT,
	},
	{
		name: "Gemini",
		company: "Google",
        model: process.env.NEXT_PUBLIC_GOOGLE_GENERATIVE_AI_MODEL,
		icon: Gemini,
	},
	{
		name: "Claude",
		company: "Anthropic",
        model: process.env.NEXT_PUBLIC_ANTHROPIC_MODEL,
		icon: Claude,
	},
];