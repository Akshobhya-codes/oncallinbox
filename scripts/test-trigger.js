// Fires a real outbound call via your running server. Requires the server up
// (npm run dev) and valid VAPI_* env. Calls USER_PHONE from .env by default;
// pass a number to override.
// Usage: node scripts/test-trigger.js            (uses preset USER_PHONE)
//        node scripts/test-trigger.js +15551234567   (override)
const phoneNumber = process.argv[2];
const port = process.env.PORT || 3000;

const payload = {
  email: {
    inboxId: process.env.AGENTMAIL_DEFAULT_INBOX_ID || "demo-inbox",
    messageId: "demo-message-id", // replace with a real AgentMail messageId to actually thread+send
    from: "ops@acme.com",
    subject: "Production webhook failures for Acme — contract at risk",
    body: "Our webhooks have been failing for 2 hours and we're losing orders. We need an ETA today.",
  },
  // Omit `user` to use the preset USER_PHONE; include it only to override.
  ...(phoneNumber ? { user: { name: "Test", phoneNumber } } : {}),
};

const res = await fetch(`http://localhost:${port}/api/trigger-call`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(process.env.INTERNAL_API_KEY ? { "x-api-key": process.env.INTERNAL_API_KEY } : {}),
  },
  body: JSON.stringify(payload),
});

console.log(res.status, await res.text());
