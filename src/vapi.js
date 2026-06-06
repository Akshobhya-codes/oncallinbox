import { config, webhookUrl } from "./config.js";

const { apiKey, baseUrl, phoneNumberId, voiceProvider, voiceId } = config.vapi;

/**
 * Place an outbound call to the user about an urgent email. The assistant is
 * created "transient" (inline) so we can inject this specific email's context
 * into the system prompt + first message, and attach the send_reply tool that
 * calls our webhook mid-call.
 *
 * @param {object} email  { from, subject, body, inboxId, messageId }
 * @param {object} user   { name, phoneNumber }
 * @returns {Promise<{id:string}>} the created Vapi call (id used to key context)
 */
export async function createOutboundCall(email, user) {
  if (!user?.phoneNumber) throw new Error("user.phoneNumber is required to place a call.");

  const senderLabel = email.from || "a sender";
  const firstMessage =
    `Hi${user.name ? " " + user.name : ""}, this is your inbox assistant. ` +
    `You just got an urgent email from ${senderLabel}. ` +
    `${shortSummary(email)} ` +
    `Do you want me to reply for you?`;

  const systemPrompt = [
    `You are a voice assistant calling ${user.name || "the user"} about an urgent email so they can respond hands-free.`,
    ``,
    `THE EMAIL:`,
    `From: ${email.from || "unknown"}`,
    `Subject: ${email.subject || "(no subject)"}`,
    `Body: ${truncate(email.body || "(no body)", 1200)}`,
    ``,
    `YOUR JOB:`,
    `1. Briefly tell them what the email is about and what the sender needs.`,
    `2. Ask if they want to reply.`,
    `3. If yes, ask what they'd like to say and let them speak freely.`,
    `4. Read their intended reply back in one short sentence to confirm.`,
    `5. Once they confirm, call the send_reply tool with their instructions verbatim-in-meaning.`,
    `6. After the tool reports success, tell them the reply was sent, then ask if there's anything else, and end the call.`,
    `If they don't want to reply, acknowledge and end the call politely.`,
    ``,
    `STYLE: Be brief and natural. This is a phone call — short sentences, no jargon. Never read the raw email verbatim; summarize.`,
  ].join("\n");

  const assistant = {
    firstMessage,
    firstMessageMode: "assistant-speaks-first",
    model: {
      provider: "openai",
      model: config.openai.model,
      temperature: 0.5,
      messages: [{ role: "system", content: systemPrompt }],
      tools: [
        {
          type: "function",
          async: false, // wait for our webhook so the assistant can confirm "sent"
          function: {
            name: "send_reply",
            description:
              "Send an email reply on the user's behalf. Call this ONLY after the user has confirmed what they want to say.",
            parameters: {
              type: "object",
              properties: {
                instructions: {
                  type: "string",
                  description:
                    "What the user wants the reply to say, in their own intent. e.g. 'Tell them we're investigating, ask for logs, I'll follow up in 30 minutes.'",
                },
              },
              required: ["instructions"],
            },
          },
          server: { url: webhookUrl() },
        },
      ],
    },
    voice: { provider: voiceProvider, voiceId },
    server: { url: webhookUrl() },
    endCallFunctionEnabled: true,
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 300,
  };

  const payload = {
    phoneNumberId,
    customer: { number: user.phoneNumber },
    assistant,
    // Fallback context in case we ever need it from the webhook's call object.
    metadata: {
      inboxId: email.inboxId || "",
      messageId: email.messageId || "",
      from: email.from || "",
      subject: email.subject || "",
    },
  };

  const res = await fetch(`${baseUrl}/call/phone`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`Vapi ${res.status}: ${json.message || text}`);
  }
  return json;
}

function shortSummary(email) {
  const subj = email.subject ? `It's about: ${email.subject}.` : "";
  return subj;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
