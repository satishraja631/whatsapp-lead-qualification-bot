# 💬 WhatsApp Lead Qualification Bot — Demo

An AI automation demo: a WhatsApp-style chat widget where inbound customer
messages are classified by **Claude**, scored as sales leads, and logged to a
live **CRM dashboard** — all in one page.

> **This is a portfolio demo.** The WhatsApp layer is *simulated* (you type as
> the "customer" in a styled chat widget). Everything else — the AI
> classification, structured extraction, lead scoring, hot-lead alerting, and
> persistence — works end to end and maps directly onto a real production build.

![flow](https://img.shields.io/badge/flow-trigger%20%E2%86%92%20AI%20%E2%86%92%20action-10b981)

---

## What this demo shows

1. **A WhatsApp-style chat widget** — green header, message bubbles, timestamps.
   You send messages as a customer.
2. **AI classification with Claude** — each message is sent to
   `claude-haiku-4-5` with a system prompt that returns **structured JSON**:

   ```json
   {
     "intent": "buying | renting | inquiry | spam | other",
     "lead_score": "hot | warm | cold",
     "extracted_info": { "name": "", "need": "", "budget": "", "urgency": "" },
     "suggested_reply": ""
   }
   ```

3. **An automated reply** — the `suggested_reply` is shown back in the chat as
   the "bot's" WhatsApp response.
4. **Multi-turn conversation memory** — the bot remembers the whole thread, so
   follow-ups work ("my budget is 30k", "yes that works"). Each conversation is
   one evolving lead whose score warms up and whose extracted info fills in as
   the chat progresses. *(See "How memory works" below.)*
5. **A CRM dashboard** — each conversation is one row that updates live, with
   timestamp, latest message, turn count, intent, color-coded score
   (🔴 hot / 🟡 warm / 🔵 cold), accumulated extracted info, and the reply sent.
5. **Hot-lead alerting** — when a lead scores `hot`, a badge animation fires.
   *In production this triggers a real-time Slack alert to the sales team.*
6. **Industry versatility** — a dropdown switches the business context (Real
   Estate, Coaching/Education, Ecommerce, Clinic/Healthcare), changing the
   system prompt so the same engine works across verticals.
7. **Quick-test buttons** — pre-written sample messages for fast demos /
   screen recordings.

---

## Architecture: trigger → AI processing → action

```
  ┌─────────────┐     POST /api/message      ┌──────────────────┐
  │ Chat widget │ ─────────────────────────▶ │  Express server  │
  │  (public/)  │                            │   (server.js)    │
  └─────────────┘                            └────────┬─────────┘
        ▲                                              │
        │                                  ┌───────────▼───────────┐
        │                                  │  AI processing         │
        │                                  │  src/claude.js         │
        │                                  │  + src/prompts.js      │
        │                                  │  → Claude classifies   │
        │                                  │  → robust JSON parse   │
        │                                  └───────────┬───────────┘
        │                                              │
        │           { lead }                ┌──────────▼──────────┐
        └───────────────────────────────────│  Action / storage   │
            reply shown in chat +            │  src/storage.js      │
            row added to CRM dashboard       │  → data/leads.json   │
                                             └──────────────────────┘
```

| Stage    | Production equivalent                          | In this demo                          |
| -------- | ---------------------------------------------- | ------------------------------------- |
| Trigger  | WhatsApp Business API webhook (inbound message)| Chat widget POSTs to `/api/message`   |
| AI       | Claude classifies + extracts + drafts reply    | ✅ identical (`src/claude.js`)        |
| Action 1 | Send reply via WhatsApp Business API           | Reply rendered in the chat widget     |
| Action 2 | Log to Google Sheets / CRM via API             | Appended to `data/leads.json`         |
| Action 3 | Slack alert on hot leads                        | Animated badge + on-screen note       |

### Project structure

```
.
├── server.js            # Express entry point + routes (the "wiring")
├── src/
│   ├── claude.js        # Claude API logic — isolated AI processing
│   ├── prompts.js       # Per-industry system prompts
│   ├── conversations.js # Per-conversation message history (the "memory")
│   └── storage.js       # Lead persistence (local JSON file)
├── public/
│   ├── index.html       # Chat widget + CRM dashboard (Tailwind via CDN)
│   ├── styles.css       # WhatsApp bubble styling + animations
│   └── app.js           # Frontend logic (vanilla JS)
├── data/leads.json      # Created at runtime (git-ignored)
├── .env.example
└── package.json
```

The Claude logic (`src/claude.js`) is deliberately separated from the routing
and storage so each piece can be explained on its own.

---

## Running it locally

**Requirements:** Node.js 18+ and an [Anthropic API key](https://console.anthropic.com/settings/keys).

```bash
# 1. Install dependencies
npm install

# 2. Configure your API key
cp .env.example .env
#    then edit .env and paste your real ANTHROPIC_API_KEY

# 3. Start the server
npm start

# 4. Open the app
open http://localhost:3000
```

### Test the backend with curl (before/without the UI)

The webhook-style endpoint can be exercised directly:

```bash
curl -s -X POST http://localhost:3000/api/message \
  -H 'Content-Type: application/json' \
  -d '{
        "conversationId": "demo-1",
        "message": "Looking for a 2BHK rental under 25k, need to move in this weekend",
        "businessType": "real_estate"
      }' | python3 -m json.tool
```

Reuse the same `conversationId` to continue the thread — the bot remembers the
earlier turn:

```bash
curl -s -X POST http://localhost:3000/api/message \
  -H 'Content-Type: application/json' \
  -d '{ "conversationId": "demo-1", "message": "actually my budget is 30k" }' \
  | python3 -m json.tool
# extracted_info.budget updates to "30k" and the reply acknowledges the change
```

Expected response (values will vary):

```json
{
  "lead": {
    "id": "…",
    "timestamp": "2026-06-24T…Z",
    "message": "Looking for a 2BHK rental under 25k, need to move in this weekend",
    "businessType": "real_estate",
    "intent": "renting",
    "lead_score": "hot",
    "extracted_info": {
      "name": "",
      "need": "2BHK rental",
      "budget": "25k",
      "urgency": "this weekend"
    },
    "suggested_reply": "Great — I can help with that! …"
  }
}
```

Other endpoints:

- `GET /api/business-types` — list of industries for the dropdown
- `GET /api/leads` — all stored leads (used to hydrate the dashboard)
- `POST /api/reset` — clear a conversation's memory (`{ "conversationId": "…" }`)

---

## How memory works

The Claude API is **stateless** — it never remembers anything between requests
on its own. Memory is something the *application* provides by re-sending the
running conversation thread on every request:

```js
// Each turn, the server sends the whole thread — not just the latest message:
messages: [
  { role: "user",      content: "Looking for a 2BHK rental" },
  { role: "assistant", content: "{…\"suggested_reply\":\"Great! What's your budget?\"}" },
  { role: "user",      content: "my budget is 30k" }   // ← now Claude has context
]
```

In this demo each conversation is keyed by a browser-generated `conversationId`
and the history is held in memory (`src/conversations.js`). The "+ New
conversation" button (or switching industry) starts a fresh thread.

**In production**, you'd key the thread by the customer's **WhatsApp phone
number** (which arrives in the webhook) and store it in Redis/Postgres — so each
customer has a persistent, independent conversation that survives restarts and
spans days. The classification logic in `src/claude.js` stays exactly the same.

---

## How it maps to a real WhatsApp Business API integration

To turn this demo into production, swap the simulated layer for the real one:

1. **Receive messages.** Register a webhook with the
   [WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api).
   Meta POSTs inbound messages to your endpoint — point that at `/api/message`
   (the handler is already shaped like a webhook). Add signature verification.
2. **Remember.** Replace the in-memory `src/conversations.js` with a Redis/
   Postgres store keyed by the customer's phone number, so each customer has a
   persistent thread. `src/claude.js` already expects the history to be passed in.
3. **Process.** Keep `src/claude.js` exactly as-is — this is the core value.
4. **Reply.** Instead of returning the reply to a browser, call the WhatsApp
   `POST /{phone-number-id}/messages` endpoint to send `suggested_reply` back
   to the customer (optionally with human-in-the-loop approval for hot leads).
5. **Log.** Replace `src/storage.js` with a Google Sheets / HubSpot / Salesforce
   API call so leads land in the team's CRM.
6. **Alert.** On `lead_score === "hot"`, POST to a Slack incoming webhook so
   sales gets a real-time ping.

The two "In production…" notes in the UI mark exactly these swap points.

---

## Notes on the implementation

- **API key safety** — the key is read from the `ANTHROPIC_API_KEY` environment
  variable via the official SDK; it is never hardcoded and `.env` is git-ignored.
- **Robust JSON parsing** — Claude's output is parsed defensively: Markdown code
  fences are stripped, the outermost `{…}` is extracted if extra prose appears,
  and every field is validated/coerced so malformed output can never crash the
  UI (`src/claude.js`).
- **Graceful errors** — API failures return a friendly message in the chat
  instead of crashing the server.
- **Model** — `claude-haiku-4-5` is used because it's fast and cost-effective
  for high-volume message classification.

---

## License

MIT — demo / portfolio use.
# whatsapp-lead-qualification-bot
