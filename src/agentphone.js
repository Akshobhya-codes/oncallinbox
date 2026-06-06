import { config } from "./config.js";

// Thin REST client for AgentPhone (https://docs.agentphone.ai).
// Base: https://api.agentphone.ai/v1, Bearer auth.

const { apiKey, baseUrl } = config.agentphone;

async function ap(path, method = "GET", body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`AgentPhone ${res.status} ${method} ${path}: ${json.message || json.error || text}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// --- Agents ---
export function createAgent({ name, beginMessage, voice }) {
  return ap("/agents", "POST", {
    name,
    voiceMode: "webhook", // AgentPhone forwards transcripts to our webhook; we return the reply
    beginMessage,
    voice: voice || config.agentphone.voice,
    sttMode: "fast",
    denoisingMode: "noise-cancellation",
  });
}

// --- Project-wide webhook (where agent.message events are delivered) ---
export function setProjectWebhook(url, secret) {
  return ap("/webhooks", "POST", { url, ...(secret ? { secret } : {}) });
}

// --- Numbers ---
export function listNumbers() {
  return ap("/numbers?limit=20&offset=0");
}
export function provisionNumber({ country = "US", areaCode, agentId }) {
  return ap("/numbers", "POST", { country, areaCode, agentId });
}
export function attachNumber(agentId, numberId) {
  return ap(`/agents/${agentId}/numbers`, "POST", { numberId });
}

// --- Outbound call ---
export function createCall({ agentId, toNumber, initialGreeting, fromNumberId }) {
  return ap("/calls", "POST", {
    agentId,
    toNumber,
    ...(initialGreeting ? { initialGreeting } : {}),
    ...(fromNumberId ? { fromNumberId } : {}),
  });
}
