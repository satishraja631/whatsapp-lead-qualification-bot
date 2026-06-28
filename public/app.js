// public/app.js
// Frontend logic for the WhatsApp Lead Qualification Bot demo (vanilla JS).

const chat = document.getElementById("chat");
const composer = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const samplesEl = document.getElementById("samples");
const businessSelect = document.getElementById("businessType");
const leadRows = document.getElementById("leadRows");
const leadCount = document.getElementById("leadCount");
const emptyState = document.getElementById("emptyState");
const hotAlert = document.getElementById("hotAlert");
const newChatBtn = document.getElementById("newChat");
const turnLabel = document.getElementById("turnLabel");

// Identifies the current conversation (stands in for a WhatsApp phone number).
let conversationId = crypto.randomUUID();

// Track dashboard rows + last-seen score per lead so we can update in place
// and detect when a lead newly becomes "hot".
const leadRowsById = new Map();
const leadScoreById = new Map();

const INTRO =
  "👋 Hi! Send a message (or tap a quick test) to see the bot qualify the lead. It remembers the whole conversation — try a follow-up like \"my budget is 30k\".";

// Pre-written sample messages for quick demos / screen recordings.
const SAMPLES = [
  "Looking for a 2BHK rental under 25k, need to move in this weekend",
  "Do you have beginner coding bootcamps?",
  "Is the blue running shoe available in size 10? Need it by Friday",
  "I'd like to book a dental checkup next week",
  "Just browsing, what areas do you cover?",
  "WIN A FREE IPHONE!!! Click this link now",
];

// ---- Helpers ---------------------------------------------------------------

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function scrollChat() {
  chat.scrollTop = chat.scrollHeight;
}

function addBubble(text, direction) {
  const wrap = document.createElement("div");
  wrap.className = "flex";
  const bubble = document.createElement("div");
  bubble.className = `bubble ${direction === "out" ? "bubble-out" : "bubble-in"}`;
  bubble.innerHTML = `${escapeHtml(text)}<span class="time">${nowTime()}</span>`;
  wrap.appendChild(bubble);
  chat.appendChild(wrap);
  scrollChat();
}

function showTyping() {
  const wrap = document.createElement("div");
  wrap.className = "flex";
  wrap.id = "typing";
  wrap.innerHTML = `<div class="bubble bubble-in typing"><span></span><span></span><span></span></div>`;
  chat.appendChild(wrap);
  scrollChat();
}

function removeTyping() {
  document.getElementById("typing")?.remove();
}

function badge(score) {
  const cls = score === "hot" ? "badge-hot" : score === "warm" ? "badge-warm" : "badge-cold";
  const icon = score === "hot" ? "🔥 " : "";
  return `<span class="badge ${cls}">${icon}${escapeHtml(score)}</span>`;
}

function extractedSummary(info) {
  const parts = [];
  if (info.name) parts.push(`👤 ${info.name}`);
  if (info.need) parts.push(`📝 ${info.need}`);
  if (info.budget) parts.push(`💰 ${info.budget}`);
  if (info.urgency) parts.push(`⏱️ ${info.urgency}`);
  return parts.length ? parts.map(escapeHtml).join("<br>") : '<span class="text-slate-400">—</span>';
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ---- CRM dashboard ---------------------------------------------------------

function renderLeadRow(lead, { flash = false } = {}) {
  const tr = document.createElement("tr");
  tr.className = "border-b border-slate-100 align-top" + (flash ? " hot-flash" : "");
  const turns = lead.messageCount
    ? `<div class="text-[10px] text-slate-400">${lead.messageCount} turn${lead.messageCount === 1 ? "" : "s"}</div>`
    : "";
  tr.innerHTML = `
    <td class="py-2 pr-2 text-xs text-slate-500 whitespace-nowrap">${formatTime(lead.timestamp)}${turns}</td>
    <td class="py-2 pr-2 max-w-[160px]"><div class="text-slate-700">${escapeHtml(lead.message)}</div></td>
    <td class="py-2 pr-2 capitalize text-slate-600">${escapeHtml(lead.intent)}</td>
    <td class="py-2 pr-2">${badge(lead.lead_score)}</td>
    <td class="py-2 pr-2 text-xs text-slate-600 leading-relaxed">${extractedSummary(lead.extracted_info)}</td>
    <td class="py-2 text-xs text-slate-500 max-w-[180px]">${escapeHtml(lead.suggested_reply)}</td>
  `;
  return tr;
}

function updateLeadCount() {
  const n = leadRowsById.size;
  leadCount.textContent = `${n} lead${n === 1 ? "" : "s"}`;
  emptyState.classList.toggle("hidden", n > 0);
}

function flashHotAlert() {
  hotAlert.classList.remove("hidden");
  hotAlert.classList.remove("alert-pop");
  void hotAlert.offsetWidth; // restart animation
  hotAlert.classList.add("alert-pop");
}

// Insert a new lead row, or update the existing one in place (same conversation).
function upsertLeadToDashboard(lead, { isNew = false } = {}) {
  const prevScore = leadScoreById.get(lead.id);
  const becameHot = lead.lead_score === "hot" && prevScore !== "hot";
  leadScoreById.set(lead.id, lead.lead_score);

  const row = renderLeadRow(lead, { flash: isNew && becameHot });
  const existing = leadRowsById.get(lead.id);
  if (existing) existing.remove();
  leadRows.prepend(row); // most recent activity on top
  leadRowsById.set(lead.id, row);

  updateLeadCount();
  if (isNew && becameHot) flashHotAlert();
}

// ---- Sending ---------------------------------------------------------------

async function sendMessage(text) {
  const message = text.trim();
  if (!message) return;

  addBubble(message, "out");
  input.value = "";
  sendBtn.disabled = true;
  showTyping();

  try {
    const res = await fetch("/api/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, message, businessType: businessSelect.value }),
    });
    const data = await res.json();
    removeTyping();

    if (!res.ok) {
      addBubble(data.error || "Something went wrong. Please try again.", "in");
      return;
    }

    addBubble(data.lead.suggested_reply, "in");
    upsertLeadToDashboard(data.lead, { isNew: true });
    const turns = data.lead.messageCount || 0;
    turnLabel.textContent = `${turns} message${turns === 1 ? "" : "s"} in`;
  } catch {
    removeTyping();
    addBubble("⚠️ Network error — is the server running?", "in");
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

// ---- Init ------------------------------------------------------------------

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(input.value);
});

// Start a fresh conversation: clear the chat + the bot's memory. Existing leads
// stay on the dashboard as historical records; the next message starts a new one.
async function newConversation() {
  const previous = conversationId;
  conversationId = crypto.randomUUID();
  // Best-effort: free the old conversation's memory on the server.
  fetch("/api/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId: previous }),
  }).catch(() => {});

  chat.innerHTML = "";
  turnLabel.textContent = "new conversation";
  addBubble(INTRO, "in");
  input.focus();
}

newChatBtn.addEventListener("click", newConversation);

// Switching industry = a different customer/context, so start fresh.
businessSelect.addEventListener("change", newConversation);

SAMPLES.forEach((text) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className =
    "text-xs bg-slate-100 hover:bg-emerald-100 text-slate-600 hover:text-emerald-800 border border-slate-200 rounded-full px-3 py-1 transition";
  btn.textContent = text.length > 42 ? text.slice(0, 40) + "…" : text;
  btn.title = text;
  btn.addEventListener("click", () => sendMessage(text));
  samplesEl.appendChild(btn);
});

async function loadBusinessTypes() {
  try {
    const res = await fetch("/api/business-types");
    const { businessTypes, default: def } = await res.json();
    businessSelect.innerHTML = businessTypes
      .map((t) => `<option value="${t.key}">${escapeHtml(t.label)}</option>`)
      .join("");
    businessSelect.value = def;
  } catch {
    businessSelect.innerHTML = '<option value="real_estate">Real Estate</option>';
  }
}

async function loadLeads() {
  try {
    const res = await fetch("/api/leads");
    const { leads } = await res.json();
    // Stored newest-first; render oldest-first so prepend keeps newest on top.
    [...leads].reverse().forEach((lead) => upsertLeadToDashboard(lead));
  } catch {
    /* dashboard simply starts empty */
  }
}

(async function init() {
  await loadBusinessTypes();
  await loadLeads();
  addBubble(INTRO, "in");
  input.focus();
})();
