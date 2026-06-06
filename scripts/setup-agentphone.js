// One-time AgentPhone setup: creates the agent, registers our webhook URL, and
// ensures there's a phone number to call from. Prints the IDs to paste into .env.
//
// Run: node scripts/setup-agentphone.js
import "dotenv/config";
import { createAgent, setProjectWebhook, listNumbers, provisionNumber, attachNumber } from "../src/agentphone.js";

const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/$/, "");

async function main() {
  if (!process.env.AGENTPHONE_API_KEY) throw new Error("Set AGENTPHONE_API_KEY in .env first.");
  if (!PUBLIC_URL) throw new Error("Set PUBLIC_URL in .env first (run ngrok).");

  const webhookUrl = `${PUBLIC_URL}/api/agentphone/webhook`;

  // 1. Register the project webhook so AgentPhone sends us transcripts.
  try {
    const wh = await setProjectWebhook(webhookUrl, process.env.AGENTPHONE_WEBHOOK_SECRET || undefined);
    console.log("✅ Webhook registered:", webhookUrl, wh.secret ? "(secret returned — save it!)" : "");
    if (wh.secret) console.log("   AGENTPHONE_WEBHOOK_SECRET=" + wh.secret);
  } catch (e) {
    console.warn("⚠️  Webhook registration:", e.message);
  }

  // 2. Create the agent (webhook voice mode — our server drives the conversation).
  const agent = await createAgent({
    name: "OncallInbox Assistant",
    beginMessage: "Hi, this is your inbox assistant. Give me one moment.",
  });
  const agentId = agent.id || agent.agentId;
  console.log("✅ Agent created:", agentId);

  // 3. Ensure a from-number exists and is attached to the agent.
  let numberId = process.env.AGENTPHONE_NUMBER_ID;
  if (!numberId) {
    const nums = await listNumbers().catch(() => ({ data: [] }));
    const list = nums.data || nums.numbers || nums || [];
    if (Array.isArray(list) && list.length) {
      numberId = list[0].id || list[0].numberId;
      console.log("ℹ️  Using existing number:", list[0].phoneNumber || numberId);
      try { await attachNumber(agentId, numberId); } catch {}
    } else {
      const provisioned = await provisionNumber({ country: "US", agentId });
      numberId = provisioned.id || provisioned.numberId;
      console.log("✅ Provisioned new number:", provisioned.phoneNumber || numberId);
    }
  }

  console.log("\n=== Paste these into .env ===");
  console.log("AGENTPHONE_AGENT_ID=" + agentId);
  console.log("AGENTPHONE_NUMBER_ID=" + (numberId || "(none — provision one in the dashboard)"));
  console.log("\nThen restart the server and run: node scripts/test-trigger.js");
}

main().catch((e) => {
  console.error("❌", e.message, e.body ? JSON.stringify(e.body) : "");
  process.exit(1);
});
