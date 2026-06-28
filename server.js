// server.js
//
// Express entry point. Wires together the three layers:
//   - src/claude.js   : AI classification (the "AI processing" step)
//   - src/storage.js  : lead persistence (the "action" step)
//   - src/prompts.js  : per-industry context
//
// Flow:  POST /api/message  ->  Claude classifies  ->  store lead  ->  return JSON

import "dotenv/config";
import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyMessage } from "./src/claude.js";
import { upsertLead, getLeads } from "./src/storage.js";
import { BUSINESS_TYPES, DEFAULT_BUSINESS_TYPE } from "./src/prompts.js";
import {
  getHistory,
  appendTurn,
  turnCount,
  resetConversation,
} from "./src/conversations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// Fail fast with a clear message if the API key is missing.
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "\n⚠️  ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.\n" +
      "   The server will start, but /api/message will return an error until it's set.\n"
  );
}

// Expose the available business types to the frontend (for the dropdown).
app.get("/api/business-types", (req, res) => {
  const types = Object.entries(BUSINESS_TYPES).map(([key, { label }]) => ({ key, label }));
  res.json({ businessTypes: types, default: DEFAULT_BUSINESS_TYPE });
});

// Return all stored leads (used to populate the CRM dashboard on load).
app.get("/api/leads", async (req, res) => {
  try {
    res.json({ leads: await getLeads() });
  } catch (err) {
    console.error("Failed to read leads:", err);
    res.status(500).json({ error: "Could not load leads." });
  }
});

// Webhook-style endpoint: in production this is what the WhatsApp Business API
// would POST inbound messages to. Here the chat widget calls it directly.
app.post("/api/message", async (req, res) => {
  const { conversationId, message, businessType } = req.body || {};

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "A non-empty 'message' is required." });
  }
  if (!conversationId || typeof conversationId !== "string") {
    return res.status(400).json({ error: "A 'conversationId' is required." });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "Server is missing ANTHROPIC_API_KEY. Add it to your .env file and restart.",
    });
  }

  const text = message.trim();
  const type = businessType || DEFAULT_BUSINESS_TYPE;

  try {
    // Send the running conversation thread to Claude (this is the "memory").
    const history = getHistory(conversationId);
    const result = await classifyMessage({ history, message: text, businessType: type });

    // Persist this turn so the next message has context. We store the canonical
    // JSON as the assistant turn for a consistent format on the next request.
    appendTurn(conversationId, text, JSON.stringify(result));

    // One evolving lead per conversation.
    const lead = await upsertLead({
      id: conversationId,
      businessType: type,
      message: text,
      messageCount: turnCount(conversationId),
      ...result,
    });

    res.json({ lead });
  } catch (err) {
    // Friendly, non-crashing error — the chat widget shows this to the user.
    console.error("Classification failed:", err.message);
    res.status(502).json({
      error: "Sorry — I couldn't process that right now. Please try again.",
    });
  }
});

// Clear a conversation's memory (used by the "New conversation" button).
app.post("/api/reset", (req, res) => {
  const { conversationId } = req.body || {};
  if (conversationId && typeof conversationId === "string") {
    resetConversation(conversationId);
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\n🟢 WhatsApp Lead Qualification Bot running at http://localhost:${PORT}\n`);
});
