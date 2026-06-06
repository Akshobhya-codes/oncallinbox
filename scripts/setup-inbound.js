// Configures the Vapi phone number for INBOUND calls: you dial the number and
// reach the inbox assistant live (no outbound voicemail problems). Creates a
// persistent assistant with a demo urgent email baked in + the send_reply tool,
// then attaches it to your VAPI_PHONE_NUMBER_ID.
//
// Run: node scripts/setup-inbound.js
import "dotenv/config";

const VAPI = "https://api.vapi.ai";
const KEY = process.env.VAPI_API_KEY;
const PHONE_ID = process.env.VAPI_PHONE_NUMBER_ID;
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

// The demo email the assistant will talk about. The reply will be sent to `from`.
const demoEmail = {
  inboxId: process.env.AGENTMAIL_DEFAULT_INBOX_ID || "abhi-5671@agentmail.to",
  from: process.env.DEMO_REPLY_TO || "akshobhya.gupta.dev@gmail.com",
  subject: "Production webhook failures for Acme — contract at risk",
  body: "Our webhooks have been failing for 2 hours and we are losing orders. We need an ETA today or we escalate to leadership.",
};

// Bake the email context into the tool URL so the inbound webhook knows who to reply to.
const toolUrl =
  `${PUBLIC_URL}/api/vapi/webhook?` +
  new URLSearchParams({
    inboxId: demoEmail.inboxId,
    from: demoEmail.from,
    subject: demoEmail.subject,
    userName: process.env.USER_NAME || "there",
  }).toString();

const assistant = {
  name: "OncallInbox Inbound Demo",
  firstMessage:
    `Hi, this is your inbox assistant. You have an urgent email from ${demoEmail.from}. ` +
    `It's about: ${demoEmail.subject}. Do you want me to reply for you?`,
  firstMessageMode: "assistant-speaks-first",
  model: {
    provider: "openai",
    model: MODEL,
    temperature: 0.5,
    messages: [
      {
        role: "system",
        content: [
          `You are a voice assistant helping the user respond to an urgent email hands-free.`,
          ``,
          `THE EMAIL:`,
          `From: ${demoEmail.from}`,
          `Subject: ${demoEmail.subject}`,
          `Body: ${demoEmail.body}`,
          ``,
          `Briefly tell them what it's about, ask if they want to reply, let them say what to say,`,
          `read it back in one sentence to confirm, then call send_reply with their instructions.`,
          `After the tool succeeds, tell them it's sent. Keep it short and natural — this is a phone call.`,
        ].join("\n"),
      },
    ],
    tools: [
      {
        type: "function",
        async: false,
        function: {
          name: "send_reply",
          description: "Send the email reply. Call ONLY after the user confirms what to say.",
          parameters: {
            type: "object",
            properties: {
              instructions: {
                type: "string",
                description: "What the user wants the reply to say, in their own intent.",
              },
            },
            required: ["instructions"],
          },
        },
        server: { url: toolUrl },
      },
    ],
  },
  voice: {
    provider: process.env.VAPI_VOICE_PROVIDER || "11labs",
    voiceId: process.env.VAPI_VOICE_ID || "burt",
  },
  server: { url: `${PUBLIC_URL}/api/vapi/webhook` },
  endCallFunctionEnabled: true,
  silenceTimeoutSeconds: 30,
  maxDurationSeconds: 300,
};

async function main() {
  if (!PUBLIC_URL) throw new Error("PUBLIC_URL not set in .env (run ngrok first).");

  // 1. Create the assistant.
  let res = await fetch(`${VAPI}/assistant`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(assistant),
  });
  let body = await res.json();
  if (!res.ok) throw new Error(`Create assistant failed ${res.status}: ${JSON.stringify(body)}`);
  const assistantId = body.id;
  console.log("✅ Created inbound assistant:", assistantId);

  // 2. Attach it to the phone number for inbound calls.
  res = await fetch(`${VAPI}/phone-number/${PHONE_ID}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ assistantId }),
  });
  body = await res.json();
  if (!res.ok) throw new Error(`Attach to number failed ${res.status}: ${JSON.stringify(body)}`);

  console.log(`✅ Attached to number: ${body.number}`);
  console.log(`\n📞 Now CALL ${body.number} from any phone and talk to the assistant live.`);
  console.log(`   The reply will be emailed to: ${demoEmail.from}`);
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
