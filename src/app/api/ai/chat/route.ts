import {NextResponse} from 'next/server'
import OpenAI from 'openai'

const systemPrompt = "You are a helpful assistant that can answer questions and help with tasks. Any and ALL questions should be in relation to the given title and abstract note in the beginning of the conversation as JSON format by the user. The title and abstract note are optional, but you should try to use both if provided. Do not answer any questions that are not in relation to the title and abstract note. NEVER respond in JSON, only respond in plain human readable text.";

export async function POST(req: Request) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })

  const data = await req.json()

  const completion = await openai.chat.completions.create({
    messages: [{role: 'system', content: systemPrompt}, ...data],
    model: process.env.OPENAI_MODEL as any,
    stream: true,
  })

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        for await (const chunk of completion) {
          const content = chunk.choices[0]?.delta?.content
          if (content) {
            const text = encoder.encode(content)
            controller.enqueue(text)
          }
        }
      } catch (err) {
        controller.error(err)
      } finally {
        controller.close()
      }
    },
  })

  return new NextResponse(stream)
}