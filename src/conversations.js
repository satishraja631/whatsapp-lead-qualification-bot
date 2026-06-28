// src/conversations.js
//
// Per-conversation message history. The Claude API is stateless — it never
// remembers anything between requests on its own. "Memory" is something the
// application provides by re-sending the running thread each turn.
//
// In this demo we key conversations by a browser-generated session ID and keep
// them in memory. In production you'd key by the customer's WhatsApp phone
// number (which arrives in the webhook) and store the thread in Redis/Postgres
// so each customer has a persistent, independent conversation.

const conversations = new Map(); // conversationId -> [{ role, content }]
const MAX_MESSAGES = 40; // safety cap so very long chats don't grow unbounded

/** Get the stored message history for a conversation (oldest first). */
export function getHistory(conversationId) {
  return conversations.get(conversationId) || [];
}

/**
 * Append one full turn: the customer's message and the assistant's response.
 * The assistant content is stored as the canonical JSON the model produced, so
 * the model sees a consistent format (and its own prior reply) on the next turn.
 */
export function appendTurn(conversationId, userContent, assistantContent) {
  const history = conversations.get(conversationId) || [];
  history.push({ role: "user", content: userContent });
  history.push({ role: "assistant", content: assistantContent });

  // Keep only the most recent messages if the thread gets very long.
  while (history.length > MAX_MESSAGES) history.shift();

  conversations.set(conversationId, history);
  return history;
}

/** Number of customer messages seen so far (i.e. conversation turn count). */
export function turnCount(conversationId) {
  return getHistory(conversationId).filter((m) => m.role === "user").length;
}

/** Clear a conversation's memory (used by the "New conversation" button). */
export function resetConversation(conversationId) {
  conversations.delete(conversationId);
}
