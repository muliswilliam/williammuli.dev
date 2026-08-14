export const prerender = false;

import type { APIRoute } from "astro";
import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { cvContext } from "../../data/cv-context";

const MODEL_ID = "claude-haiku-4-5-20251001";

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return new Response("The assistant isn't configured yet — no API key set on the server.", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
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

  const anthropic = createAnthropic({ apiKey });

  const result = streamText({
    model: anthropic(MODEL_ID),
    system: cvContext,
    messages: messages.slice(-20),
    maxOutputTokens: 120,
  });

  return result.toTextStreamResponse();
};
