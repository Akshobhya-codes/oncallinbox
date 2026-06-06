import OpenAI from "openai";
import { config } from "./config.js";

let _client;
function getClient() {
  if (!config.openai.apiKey) {
    throw new Error("OPENAI_API_KEY is not set — cannot draft a reply.");
  }
  if (!_client) _client = new OpenAI({ apiKey: config.openai.apiKey });
  return _client;
}

/**
 * Turn the user's spoken instructions (captured on the Vapi call) into a polished
 * email reply. Returns { subject, text }.
 *
 * @param {object} email   The original incoming email: { from, subject, body }
 * @param {string} instructions  What the user said they want to say, e.g.
 *        "Tell them we're investigating, ask for logs, I'll follow up in 30 min."
 * @param {object} [user]  { name } of the person we're replying on behalf of.
 */
export async function draftReply(email, instructions, user = {}) {
  const senderName = user.name || "the user";

  const system = [
    `You are an executive assistant drafting an email reply on behalf of ${senderName}.`,
    `Write a concise, professional, warm email that carries out the user's instructions exactly.`,
    `Do not invent commitments, numbers, or facts beyond what the instructions and original email contain.`,
    `Match the tone of a busy professional: clear, direct, no filler.`,
    `Do NOT include a subject line in the body. Do NOT add placeholders like [Name]; sign off as ${senderName}.`,
    `Return ONLY valid JSON: {"subject": string, "text": string}.`,
  ].join("\n");

  const userMsg = [
    `ORIGINAL EMAIL`,
    `From: ${email.from || "unknown"}`,
    `Subject: ${email.subject || "(no subject)"}`,
    `Body:`,
    email.body || "(no body provided)",
    ``,
    `USER'S SPOKEN INSTRUCTIONS FOR THE REPLY:`,
    instructions,
  ].join("\n");

  const completion = await getClient().chat.completions.create({
    model: config.openai.model,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMsg },
    ],
  });

  const raw = completion.choices[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { subject: replySubject(email.subject), text: raw };
  }

  return {
    subject: parsed.subject?.trim() || replySubject(email.subject),
    text: (parsed.text || "").trim(),
  };
}

/**
 * Drive one turn of the phone conversation (used with AgentPhone's webhook mode).
 * Given the email + conversation so far + the caller's latest utterance, decide
 * what the agent should say and whether the reply is ready to send.
 *
 * @returns {Promise<{say:string, readyToSend:boolean, instructions:string, endCall:boolean}>}
 */
export async function decideTurn({ email, history = [], transcript, user = {} }) {
  const name = user.name || "the user";
  const system = [
    `You are a voice assistant on a phone call with ${name}, helping them respond to an urgent email hands-free.`,
    ``,
    `THE EMAIL:`,
    `From: ${email.from || "unknown"}`,
    `Subject: ${email.subject || "(no subject)"}`,
    `Body: ${email.body || "(no body)"}`,
    ``,
    `Flow: confirm they want to reply, ask what to say, briefly read their intent back, then send.`,
    `Decide the NEXT thing to say. Keep it short and natural — this is a phone call.`,
    `Set readyToSend=true ONLY once the user has clearly stated what they want the reply to say`,
    `(and ideally confirmed). When readyToSend=true, put their intent in "instructions" and make`,
    `"say" a brief confirmation like "Got it, sending that now." Set endCall=true if the user is done`,
    `or doesn't want to reply.`,
    `Return ONLY JSON: {"say": string, "readyToSend": boolean, "instructions": string, "endCall": boolean}.`,
  ].join("\n");

  const convo = history
    .map((h) => `${h.direction === "outbound" ? "Assistant" : "Caller"}: ${h.content}`)
    .join("\n");
  const userMsg = `Conversation so far:\n${convo || "(just started)"}\n\nCaller just said: "${transcript}"`;

  const completion = await getClient().chat.completions.create({
    model: config.openai.model,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMsg },
    ],
  });

  let p;
  try {
    p = JSON.parse(completion.choices[0]?.message?.content || "{}");
  } catch {
    p = {};
  }
  return {
    say: (p.say || "Sorry, could you repeat that?").trim(),
    readyToSend: !!p.readyToSend,
    instructions: (p.instructions || "").trim(),
    endCall: !!p.endCall,
  };
}

function replySubject(original = "") {
  const s = original.trim();
  if (!s) return "Re: (no subject)";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}
