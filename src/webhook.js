import { draftReply } from "./openai.js";
import { sendReply } from "./agentmail.js";
import { getCallContext, deleteCallContext } from "./store.js";

/**
 * Handles all Vapi server events. The one we care about is the send_reply tool
 * call fired mid-conversation; we also clean up on end-of-call.
 *
 * Vapi has shifted payload shapes across versions, so we read defensively.
 */
export async function handleVapiWebhook(req, res) {
  const message = req.body?.message || req.body;
  const type = message?.type;

  try {
    if (type === "tool-calls" || type === "function-call") {
      const out = await handleToolCalls(message, req.query);
      return res.json(out);
    }

    if (type === "end-of-call-report" || type === "status-update") {
      const callId = message?.call?.id;
      if (type === "end-of-call-report" && callId) {
        console.log(`[vapi] call ${callId} ended (${message?.endedReason || "n/a"})`);
        deleteCallContext(callId);
      }
      return res.json({ ok: true });
    }

    // Transcript, speech-update, etc. — ack and ignore.
    return res.json({ ok: true });
  } catch (err) {
    console.error("[vapi:webhook] error:", err);
    // Still return a result so the assistant can tell the user something failed.
    return res.json({
      results: [{ toolCallId: extractFirstToolCallId(message), result: `I hit an error sending that: ${err.message}` }],
    });
  }
}

async function handleToolCalls(message, query = {}) {
  // Normalize the list of tool calls across Vapi shapes.
  const toolCalls =
    message.toolCalls ||
    message.toolCallList ||
    (message.functionCall ? [{ id: "legacy", function: message.functionCall }] : []);

  // Resolve the email context. For OUTBOUND calls we keyed it by callId at
  // trigger time. For INBOUND calls (user dials the Vapi number) there's no
  // stored context, so we fall back to call.metadata, then to query params
  // baked into the tool's server URL (?inboxId=...&from=...&subject=...).
  const callId = message?.call?.id;
  const context =
    (callId && getCallContext(callId)) ||
    metadataToContext(message?.call?.metadata) ||
    queryToContext(query);

  const results = [];
  for (const call of toolCalls) {
    const fn = call.function || call;
    const name = fn.name;
    const args = parseArgs(fn.arguments ?? fn.parameters);
    const toolCallId = call.id || call.toolCallId || "legacy";

    if (name !== "send_reply") {
      results.push({ toolCallId, result: `Unknown tool: ${name}` });
      continue;
    }

    if (!context) {
      results.push({
        toolCallId,
        result: "I couldn't find the email context for this call, so I couldn't send the reply.",
      });
      continue;
    }

    const instructions = args.instructions || "";
    if (!instructions.trim()) {
      results.push({ toolCallId, result: "I didn't catch what you wanted to say — could you repeat it?" });
      continue;
    }

    const draft = await draftReply(context.email, instructions, context.user);
    await sendReply(context.email, draft);

    console.log(`[reply] sent to ${context.email.from} | subject: ${draft.subject}`);
    results.push({
      toolCallId,
      result: `Done — I've sent the reply to ${displayName(context.email.from)}. Anything else?`,
    });
  }

  return { results };
}

function parseArgs(args) {
  if (!args) return {};
  if (typeof args === "object") return args;
  try {
    return JSON.parse(args);
  } catch {
    return {};
  }
}

function metadataToContext(metadata) {
  if (!metadata || !(metadata.from || metadata.messageId)) return null;
  return {
    email: {
      inboxId: metadata.inboxId,
      messageId: metadata.messageId,
      from: metadata.from,
      subject: metadata.subject,
      body: "",
    },
    user: {},
  };
}

// Email context passed as query params on the tool's server URL — used for
// inbound demo calls where there's no per-call stored context.
function queryToContext(query) {
  if (!query || !(query.from || query.messageId)) return null;
  return {
    email: {
      inboxId: query.inboxId,
      messageId: query.messageId,
      from: query.from,
      subject: query.subject || "(no subject)",
      body: query.body || "",
    },
    user: { name: query.userName },
  };
}

function extractFirstToolCallId(message) {
  const list = message?.toolCalls || message?.toolCallList || [];
  return list[0]?.id || "legacy";
}

function displayName(addr = "") {
  const m = addr.match(/^(.*?)\s*</);
  return (m && m[1].trim()) || addr.split("@")[0] || "them";
}
