// src/claude.js
//
// All Claude API logic lives here, isolated from routing/storage so the
// "AI processing" step is easy to explain on its own:
//
//   trigger (customer message) -> Claude classifies -> structured JSON -> action
//
// Model: claude-haiku-4-5-20251001 (fast + cheap, ideal for high-volume
// classification of inbound messages).

import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt } from "./prompts.js";

const MODEL = "claude-haiku-4-5-20251001";

// The SDK reads ANTHROPIC_API_KEY from the environment automatically.
// We never hardcode the key.
const client = new Anthropic();

const VALID_INTENTS = ["buying", "renting", "inquiry", "spam", "other"];
const VALID_SCORES = ["hot", "warm", "cold"];

/**
 * Strip Markdown code fences and surrounding prose so we can parse the JSON
 * even if the model wraps it in ```json ... ``` or adds a stray sentence.
 */
function extractJson(text) {
  let cleaned = text.trim();

  // Remove ```json ... ``` or ``` ... ``` fences if present.
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Fall back to grabbing the outermost { ... } if extra text remains.
  if (!cleaned.startsWith("{")) {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      cleaned = cleaned.slice(first, last + 1);
    }
  }

  return cleaned;
}

/**
 * Coerce/validate the parsed object into the shape the rest of the app expects,
 * so a malformed field from the model can never crash the UI.
 */
function normalizeResult(raw) {
  const info = (raw && typeof raw.extracted_info === "object" && raw.extracted_info) || {};

  return {
    intent: VALID_INTENTS.includes(raw?.intent) ? raw.intent : "other",
    lead_score: VALID_SCORES.includes(raw?.lead_score) ? raw.lead_score : "cold",
    extracted_info: {
      name: typeof info.name === "string" ? info.name : "",
      need: typeof info.need === "string" ? info.need : "",
      budget: typeof info.budget === "string" ? info.budget : "",
      urgency: typeof info.urgency === "string" ? info.urgency : "",
    },
    suggested_reply:
      typeof raw?.suggested_reply === "string" && raw.suggested_reply.trim()
        ? raw.suggested_reply.trim()
        : "Thanks for reaching out! Could you tell me a little more about what you're looking for?",
  };
}

/**
 * Classify the latest customer message in the context of the whole conversation.
 *
 * The Claude API is stateless, so we send the running thread (`history`) plus
 * the new message every time — that's what gives the bot "memory" and lets it
 * handle follow-ups like "yes" or "make it 30k".
 *
 * @param {object}   params
 * @param {Array}    params.history       Prior turns: [{ role, content }, ...].
 * @param {string}   params.message       The newest customer message.
 * @param {string}   params.businessType  Key into BUSINESS_TYPES.
 * @returns {Promise<object>}             { intent, lead_score, extracted_info, suggested_reply }
 * @throws  on API failure or unparseable output (caller shows a friendly error).
 */
export async function classifyMessage({ history = [], message, businessType }) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: buildSystemPrompt(businessType),
    messages: [...history, { role: "user", content: message }],
  });

  // Concatenate any text blocks in the response.
  const rawText = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!rawText) {
    throw new Error("Claude returned an empty response.");
  }

  let parsed;
  try {
    parsed = JSON.parse(extractJson(rawText));
  } catch {
    // Surface a clear error; the route handler turns this into a friendly
    // chat message instead of crashing.
    throw new Error("Could not parse a JSON result from Claude's response.");
  }

  return normalizeResult(parsed);
}
