// src/storage.js
//
// Simple local JSON-file persistence for qualified leads. Kept separate from
// the AI logic and routing so the "where does the data go" question has one
// clear answer.
//
// In production this is where you'd write to Google Sheets / a CRM via API
// instead of a local file (see README).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const LEADS_FILE = join(DATA_DIR, "leads.json");

async function ensureStore() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await readFile(LEADS_FILE, "utf8");
  } catch {
    await writeFile(LEADS_FILE, "[]", "utf8");
  }
}

/** Read every stored lead (newest first). */
export async function getLeads() {
  await ensureStore();
  try {
    const raw = await readFile(LEADS_FILE, "utf8");
    const leads = JSON.parse(raw);
    return Array.isArray(leads) ? leads : [];
  } catch {
    return [];
  }
}

/**
 * Insert or update the lead for a conversation.
 *
 * Each conversation is ONE lead that evolves as the chat progresses — its score
 * can warm up (cold → warm → hot) and its extracted info fills in over time.
 * Keyed by `lead.id` (the conversation ID).
 *
 * @param {object} lead  { id, message, businessType, intent, lead_score,
 *                         extracted_info, suggested_reply, messageCount }
 * @returns {Promise<object>} the stored record (with timestamp).
 */
export async function upsertLead(lead) {
  await ensureStore();
  const leads = await getLeads();

  const record = { ...lead, timestamp: new Date().toISOString() };

  const idx = leads.findIndex((l) => l.id === record.id);
  if (idx !== -1) {
    // Update the existing conversation and move it to the top (most recent activity).
    leads.splice(idx, 1);
  }
  leads.unshift(record);

  await writeFile(LEADS_FILE, JSON.stringify(leads, null, 2), "utf8");
  return record;
}
