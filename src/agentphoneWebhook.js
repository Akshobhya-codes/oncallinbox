import crypto from "crypto";
import { config } from "./config.js";
import { decideTurn, draftReply } from "./openai.js";
import { sendReply } from "./agentmail.js";
import { getCallContext, claimReplySend, releaseReplySend } from "./store.js";

/**
 * Handles AgentPhone `agent.message` (voice) webhook events. AgentPhone sends us
 * the caller's transcript each turn; we return { text } for the agent to speak.
 * When the caller has given their reply, we draft (OpenAI) + send (AgentMail) and
 * confirm, then hang up.
 *
 * Mounted with express.raw() so we can verify the HMAC signature on the raw body.
 */
export async function handleAgentPhoneWebhook(req, res) {
  const raw = req.body; // Buffer

  if (!verifySignature(req, raw)) {
    return res.status(400).json({ error: "invalid signature" });
  }

  let evt;
  try {
    evt = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "bad json" });
  }

  // Only act on voice transcripts.
  if (evt.event !== "agent.message" || evt.channel !== "voice") {
    return res.json({});
  }

  const data = evt.data || {};
  const callId = data.callId;
  const transcript = data.transcript || "";
  const history = evt.recentHistory || [];

  // Find the email context we stored when we created this call. Track the
  // effective callId so the one-shot send guard keys off the right entry.
  let effectiveCallId = callId;
  let ctx = callId && getCallContext(callId);
  if (!ctx) {
    const fb = lastContextFallback();
    if (fb) {
      effectiveCallId = fb.callId;
      ctx = getCallContext(fb.callId);
    }
  }
  if (!ctx) {
    return res.json({ text: "Sorry, I lost the context for this call. Goodbye.", hangup: true });
  }

  try {
    const decision = await decideTurn({
      email: ctx.email,
      history,
      transcript,
      user: ctx.user,
    });

    if (decision.readyToSend && decision.instructions) {
      // One-shot guard: only the first turn that crosses the threshold sends.
      if (!claimReplySend(effectiveCallId)) {
        return res.json({ text: "I've already sent that reply. Anything else?", hangup: false });
      }
      try {
        const draft = await draftReply(ctx.email, decision.instructions, ctx.user);
        await sendReply(ctx.email, draft);
        console.log(`[reply] (agentphone) sent to ${ctx.email.from} | subject: ${draft.subject}`);
      } catch (sendErr) {
        releaseReplySend(effectiveCallId); // allow a retry on failure
        throw sendErr;
      }
      return res.json({
        text: `${decision.say} Done — I've sent the reply. Goodbye.`,
        hangup: true,
      });
    }

    return res.json({ text: decision.say, hangup: decision.endCall });
  } catch (err) {
    console.error("[agentphone:webhook] error:", err);
    return res.json({ text: `Sorry, I hit an error: ${err.message}. Goodbye.`, hangup: true });
  }
}

// AgentPhone signs `{timestamp}.{rawBody}` with HMAC-SHA256. Skip if no secret set.
function verifySignature(req, raw) {
  const secret = config.agentphone.webhookSecret;
  if (!secret) return true; // dev mode

  const sig = req.get("X-Webhook-Signature");
  const ts = req.get("X-Webhook-Timestamp");
  if (!sig || !ts) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

  const signed = Buffer.concat([Buffer.from(`${ts}.`), raw]);
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(signed).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}

// Single-recipient demo fallback: if we can't match by callId, use the most
// recent call context we stored.
import { allContexts } from "./store.js";
function lastContextFallback() {
  const all = allContexts();
  if (!all.length) return null;
  return all.sort((a, b) => b.createdAt - a.createdAt)[0];
}
