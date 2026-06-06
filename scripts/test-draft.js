// Tests the OpenAI drafting backbone in isolation — no call, no email sent.
// Usage: node scripts/test-draft.js
import { draftReply } from "../src/openai.js";

const email = {
  from: "ops@acme.com",
  subject: "Production webhook failures for Acme — contract at risk",
  body: "Our webhooks have been failing for 2 hours and we're losing orders. We need an ETA today or we'll have to escalate to leadership.",
};

const instructions =
  "Tell them we're actively investigating, ask them to send the failing request logs and timestamps, and say I'll follow up personally within 30 minutes.";

const draft = await draftReply(email, instructions, { name: "Akshobhya" });
console.log("\n--- SUBJECT ---\n" + draft.subject);
console.log("\n--- BODY ---\n" + draft.text + "\n");
