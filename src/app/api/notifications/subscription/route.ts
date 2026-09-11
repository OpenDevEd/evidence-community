import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { consumeConfiguredRateLimit, aiRateLimitHeaders } from "@/lib/ai/rate-limit";
import { confirmSubscription, preferenceSchema, readSubscription, requestSubscription, signupSchema, subscriberTokenSchema, updateSubscription } from "@/lib/notifications/subscriptions";
import { createHash } from "node:crypto";
import { z } from "zod";

const mutationSchema = z.discriminatedUnion("action", [
  z.object({action: z.literal("subscribe"), ...signupSchema.shape}),
  z.object({action: z.literal("confirm"), token: subscriberTokenSchema}),
  z.object({action: z.literal("preferences"), token: subscriberTokenSchema, ...preferenceSchema.shape}),
]);
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, {status, headers: {"Cache-Control": "no-store", ...headers}});

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const config = await getLibraryConfig();
  const subscriber = await readSubscription(await getDatabaseForConfig(config), token);
  if (!subscriber) return json({error: "This subscription link is invalid."}, 404);
  return json({email: subscriber.email, digest: subscriber.digest, instant: subscriber.instant, confirmed: Boolean(subscriber.confirmedAt)});
}

async function parseMutation(request: Request) {
  const text = await request.text();
  if (text.length > 2000) return json({error: "Request too large."}, 413);
  let input: unknown;
  try {input = JSON.parse(text);} catch {return json({error: "Invalid request."}, 400);}
  const parsed = mutationSchema.safeParse(input);
  return parsed.success ? parsed.data : json({error: "Check your email address and preferences."}, 400);
}

type Mutation = z.infer<typeof mutationSchema>;
async function subscribe(request: Request, config: LibraryServerConfig, db: Database, value: Extract<Mutation, {action: "subscribe"}>) {
  if (!config.notifications.enabled) return json({error: "Email updates are unavailable."}, 503);
  if (!hasSubscription(value)) return json({error: "Choose an email subscription."}, 400);
  const limit = await signupRateLimit(request, config);
  if (!limit.allowed) return json({error: "Too many requests. Please try again later."}, 429, aiRateLimitHeaders(limit));
  await requestSubscription(db, {email: value.email, digest: value.digest, instant: value.instant});
  return json({ok: true}, 202);
}

function signupRateLimit(request: Request, config: LibraryServerConfig) {
  const ip = request.headers.get("x-real-ip")?.slice(0, 128) || "unresolved-client";
  return consumeConfiguredRateLimit({clientId: createHash("sha256").update(ip).digest("hex"), clientIp: ip, persistentClient: false}, config, {
    clientWindows: [{name: "minute", limit: 5, windowMs: 60_000}, {name: "day", limit: 20, windowMs: 86_400_000}],
    networkWindow: {name: "minute", limit: 20, windowMs: 60_000}, keyPrefix: `evidence-library:subscriptions:${config.authentication.openScholar.libraryId}`,
  });
}

async function applyMutation(request: Request, config: LibraryServerConfig, value: Mutation) {
  const db = await getDatabaseForConfig(config);
  if (value.action === "subscribe") return subscribe(request, config, db, value);
  const success = value.action === "confirm" ? await confirmSubscription(db, value.token) : await updateSubscription(db, value.token, {digest: value.digest, instant: value.instant});
  return success ? json({ok: true}) : json({error: "This link is invalid or expired."}, 400);
}

export async function POST(request: Request) {
  try {
    const value = await parseMutation(request);
    if (value instanceof Response) return value;
    return await applyMutation(request, await getLibraryConfig(), value);
  } catch (error) {
    console.error("Library subscription request failed", error);
    return json({error: "Could not save your subscription. Please try again."}, 503);
  }
}

function hasSubscription(value: {digest: boolean; instant: boolean}) {
  return value.digest || value.instant;
}
