// jsdom's VM context, on vmThreads, lacks Node's web streams, which the AI SDK's stream parser uses.
import { ReadableStream, TransformStream, WritableStream } from "node:stream/web";

globalThis.TransformStream ??= TransformStream as unknown as typeof globalThis.TransformStream;
globalThis.ReadableStream ??= ReadableStream as unknown as typeof globalThis.ReadableStream;
globalThis.WritableStream ??= WritableStream as unknown as typeof globalThis.WritableStream;

// jsdom has no matchMedia. Nothing matches here; a test that needs a match stubs its own.
globalThis.matchMedia ??= (query: string) =>
	({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
