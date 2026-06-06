import { config } from "./config.js";

const { apiKey, baseUrl, defaultInboxId } = config.agentmail;

async function agentmailFetch(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`AgentMail ${res.status}: ${json.message || text}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/**
 * Send the drafted reply. If we have the original AgentMail messageId we use the
 * reply endpoint so it threads correctly; otherwise we send a fresh message.
 *
 * @param {object} email  { inboxId, messageId, from, subject }
 * @param {object} draft  { subject, text }
 */
export async function sendReply(email, draft) {
  const inboxId = email.inboxId || defaultInboxId;
  if (!inboxId) {
    throw new Error("No AgentMail inboxId provided (set email.inboxId or AGENTMAIL_DEFAULT_INBOX_ID).");
  }

  // Preferred path: reply to the original message → automatic threading.
  if (email.messageId) {
    return agentmailFetch(
      `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(email.messageId)}/reply`,
      { text: draft.text }
    );
  }

  // Fallback: send a new message to the original sender.
  if (!email.from) {
    throw new Error("Cannot send reply: no messageId to reply to and no sender address.");
  }
  return agentmailFetch(`/inboxes/${encodeURIComponent(inboxId)}/messages/send`, {
    to: [email.from],
    subject: draft.subject,
    text: draft.text,
  });
}
