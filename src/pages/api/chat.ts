export const prerender = false;

import type { APIRoute } from "astro";
import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { env } from "cloudflare:workers";
import { cvContext } from "../../data/cv-context";
import { checkRateLimit } from "../../lib/rate-limit";

const MODEL_ID = "claude-haiku-4-5-20251001";
const MAX_MESSAGE_CHARS = 800;
const MAX_HISTORY_TURNS = 12;
const MAX_TOTAL_CHARS = 6000;

function getClientIp(request: Request, clientAddress?: string): string {
  if (clientAddress) return clientAddress;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // On Cloudflare Workers, runtime secrets come from the `cloudflare:workers`
  // module, not import.meta.env (which only has build-time values).
  const apiKey = env.ANTHROPIC_API_KEY ?? import.meta.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return new Response("The assistant isn't configured yet — no API key set on the server.", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const ip = getClientIp(request, clientAddress);
  const { allowed, retryAfterSeconds } = checkRateLimit(ip);
  if (!allowed) {
    return new Response("I'm getting a lot of messages right now — try again in a bit, or email willi.wambu@gmail.com.", {
      status: 429,
      headers: { "Content-Type": "text/plain", "Retry-After": String(retryAfterSeconds) },
    });
  }

  let messages: { role: "user" | "assistant"; content: string }[];
  try {
    const body = await request.json();
    messages = Array.isArray(body?.messages) ? body.messages : [];
  } catch {
    return new Response("Invalid request body.", { status: 400 });
  }

  if (messages.length === 0) {
    return new Response("No messages provided.", { status: 400 });
  }

  for (const m of messages) {
    if (typeof m?.content !== "string" || (m.role !== "user" && m.role !== "assistant")) {
      return new Response("Invalid message format.", { status: 400 });
    }
    if (m.content.length > MAX_MESSAGE_CHARS) {
      return new Response("Keep messages a bit shorter, please — a couple sentences is plenty.", { status: 400 });
    }
  }

  let trimmed = messages.slice(-MAX_HISTORY_TURNS);
  let totalChars = trimmed.reduce((sum, m) => sum + m.content.length, 0);
  while (totalChars > MAX_TOTAL_CHARS && trimmed.length > 1) {
    totalChars -= trimmed[0].content.length;
    trimmed = trimmed.slice(1);
  }

  const anthropic = createAnthropic({ apiKey });

  const result = streamText({
    model: anthropic(MODEL_ID),
    system: cvContext,
    messages: trimmed,
    maxOutputTokens: 120,
  });

  return result.toTextStreamResponse();
};
