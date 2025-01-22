

import ChatGPT from "@/components/icons/ChatGPT";
import Gemini from "@/components/icons/Gemini";
import Claude from "@/components/icons/Claude";
import Mistral from "@/components/icons/Mistral";

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
	{
		name: "Mistral",
		company: "Mistral",
        model: process.env.NEXT_PUBLIC_MISTRAL_MODEL,
		icon: Mistral,
	}
];

const MILLION = 1000000

export const pricings = {
	"gpt-4o": {
		input: 2.5 / MILLION,
		output: 10 / MILLION,
	},
	"gpt-4o-mini": {
		input: 0.150 / MILLION,
		output: 0.6 / MILLION,
	},
	"gemini-1.5-pro": {
		input: 1.25 / MILLION,
		output: 5 / MILLION,
	},
	"gemini-1.5-flash": {
		input: 0.075 / MILLION,
		output: 0.3 / MILLION,
	},
	"gemini-1.5-flash-8b": {
		input: 0.0375 / MILLION,
		output: 0.15 / MILLION,
	},
	"claude-3-5-sonnet-20241022": {
		input: 3 / MILLION,
		output: 15 / MILLION,
	},
	"claude-3-5-haiku-20241022": {
		input: 0.8 / MILLION,
		output: 4 / MILLION,
	},
	"mistral-large-latest": {
		input: 2 / MILLION,
		output: 6 / MILLION,
	}
}