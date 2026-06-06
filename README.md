# OncallInbox

OncallInbox is an AI on-call agent for your inbox. It monitors email, detects urgent messages, calls you when something needs attention, summarizes the issue, and turns your spoken instructions into a draft reply for approval. Stop checking email; let urgent messages call you.

---

## Voice & Reply Backbone

This is the **calling + voice + reply-sending** half of OncallInbox (steps 4→7 of the flow).
Your cofounder owns Gmail/email ingestion and urgency classification. When they decide an
email needs the human, they call **one endpoint here** and the rest is automatic:

```
urgent email  ──►  POST /api/trigger-call
                        │
                        ▼
                Vapi places a phone call to the user
                        │
              "You got an urgent email from Acme… want me to reply?"
                        │
              user speaks their reply out loud
                        │
        Vapi fires the send_reply tool ──► our webhook
                        │
              OpenAI drafts a clean email from what they said
                        │
              AgentMail sends it (threaded to the original)
                        │
              assistant says "Done, it's sent." and hangs up
```

## What's in here

| File | Job |
|------|-----|
| `src/server.js`   | Express app + routes (`/api/trigger-call`, `/api/vapi/webhook`) |
| `src/vapi.js`     | Places the outbound call with an inline assistant + `send_reply` tool |
| `src/webhook.js`  | Handles the mid-call tool call → draft → send |
| `src/openai.js`   | Turns spoken instructions into a polished email (`draftReply`) |
| `src/agentmail.js`| Sends the reply via AgentMail (threaded reply, or new message) |
| `src/store.js`    | Maps `callId → email context` for the duration of the call |

## Setup

1. `npm install`
2. `copy .env.example .env` and fill it in (see **Getting credentials** below).
3. Expose your local server so Vapi can reach the webhook:
   ```
   ngrok http 3000
   ```
   Copy the `https://…` URL into `PUBLIC_URL` in `.env`.
4. `npm run dev`

## Test it

- **Drafting only (no call, nothing sent):**
  `npm run test:draft`
- **Trigger a real call to your phone:**
  `node scripts/test-trigger.js +15551234567`
  (To actually send a reply at the end, put a real AgentMail `inboxId` + `messageId` in the script.)

## Who gets called

There's no auth and no user database — the number to call is **preset** in `.env`:

```
USER_NAME=Akshobhya
USER_PHONE=+15551234567   # E.164
```

That's who we phone for every urgent email. (You can still override per-request by
passing a `user` object, but you don't need to.)

## The contract for your cofounder

When an email is classified urgent, POST this:

```http
POST /api/trigger-call
Content-Type: application/json
x-api-key: <INTERNAL_API_KEY>   # only if you set one

{
  "email": {
    "inboxId":   "<agentmail inbox id the email landed in>",
    "messageId": "<agentmail message id of the incoming email>",
    "from":      "ops@acme.com",
    "subject":   "Production webhook failures for Acme — contract at risk",
    "body":      "Our webhooks have been failing for 2 hours..."
  }
}
```

The call goes to `USER_PHONE`. `messageId` is what lets AgentMail thread the reply
correctly; if omitted we send a fresh email to `from`.

> **Note:** the active caller is **AgentPhone** (`src/agentphone.js`) — purpose-built
> for AI agents dialing real numbers. The Vapi implementation is retained in
> `src/vapi.js` for reference. Run `node scripts/setup-agentphone.js` once to create
> the agent + register the webhook, then `POST /api/trigger-call`.
