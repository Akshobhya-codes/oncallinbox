import express from "express";
import { config } from "./config.js";
import { createOutboundCall } from "./vapi.js";
import { handleVapiWebhook } from "./webhook.js";
import { handleAgentPhoneWebhook } from "./agentphoneWebhook.js";
import { createCall as createAgentPhoneCall } from "./agentphone.js";
import { saveCallContext } from "./store.js";
import { draftReply } from "./openai.js";

const app = express();

// AgentPhone webhook needs the RAW body for HMAC verification — register it
// BEFORE the global JSON parser.
app.post("/api/agentphone/webhook", express.raw({ type: "*/*" }), handleAgentPhoneWebhook);

app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "oncall-inbox-voice" }));

// Optional shared-secret guard for the internal trigger endpoint.
function requireInternalKey(req, res, next) {
  if (!config.internalApiKey) return next();
  if (req.get("x-api-key") === config.internalApiKey) return next();
  return res.status(401).json({ error: "unauthorized" });
}

/**
 * Called by the cofounder's email pipeline when an email is classified URGENT
 * and needs the user on the phone.
 *
 * Body:
 * {
 *   "email": { "inboxId", "messageId", "from", "subject", "body" },
 *   "user":  { "name", "phoneNumber" }   // phoneNumber in E.164, e.g. +15551234567
 * }
 */
app.post("/api/trigger-call", requireInternalKey, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "email is required" });

  // Who to call: an explicit user in the request wins; otherwise the preset
  // number from .env (USER_NAME / USER_PHONE). No auth, single recipient.
  const user =
    req.body.user && req.body.user.phoneNumber ? req.body.user : config.presetUser;

  if (!user?.phoneNumber) {
    return res.status(400).json({
      error: "No number to call. Set USER_PHONE in .env, or pass user.phoneNumber in the request.",
    });
  }

  const greeting =
    `Hi${user.name ? " " + user.name : ""}, this is your inbox assistant. ` +
    `You just got an urgent email from ${email.from || "a sender"}. ` +
    `${email.subject ? "It's about: " + email.subject + ". " : ""}` +
    `Do you want me to reply for you?`;

  try {
    const call = await createAgentPhoneCall({
      agentId: config.agentphone.agentId,
      toNumber: user.phoneNumber,
      initialGreeting: greeting,
      fromNumberId: config.agentphone.numberId || undefined,
    });
    const callId = call.id || call.callId || call.call?.id;
    // Key the email context by callId so the webhook can find it each turn.
    saveCallContext(callId, { email, user });

    console.log(`[trigger] (agentphone) calling ${user.phoneNumber} about email from ${email.from} | callId=${callId}`);
    return res.json({ ok: true, callId, status: call.status || "queued" });
  } catch (err) {
    console.error("[trigger] failed:", err);
    return res.status(502).json({ error: err.message });
  }
});

// Vapi posts all call events here (tool calls, status, end-of-call).
app.post("/api/vapi/webhook", handleVapiWebhook);

// Handy for testing the OpenAI drafting in isolation (no call needed).
// POST { email:{from,subject,body}, instructions, user:{name} }
app.post("/api/draft-preview", async (req, res) => {
  const { email, instructions, user } = req.body || {};
  if (!email || !instructions) {
    return res.status(400).json({ error: "email and instructions are required" });
  }
  try {
    const draft = await draftReply(email, instructions, user || {});
    return res.json({ ok: true, draft });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.listen(config.port, () => {
  console.log(`\n  OncallInbox voice backbone running on http://localhost:${config.port}`);
  console.log(`  AgentPhone webhook: ${config.publicUrl || "<set PUBLIC_URL>"}/api/agentphone/webhook`);
  console.log(`  Trigger a call:     POST http://localhost:${config.port}/api/trigger-call\n`);
});
