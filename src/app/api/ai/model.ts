import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";

// export const provider = google
// export const model = process.env.GEMINI_MODEL!

export const provider = openai
export const model = process.env.OPENAI_MODEL!
