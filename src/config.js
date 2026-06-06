import dotenv from "dotenv";

dotenv.config();

function required(name, value) {
  if (!value) {
    // Don't crash on import — some routes work without every key (e.g. local
    // drafting needs OpenAI but not Vapi). We warn loudly instead.
    console.warn(`[config] Missing env var ${name} — features depending on it will fail.`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  publicUrl: (process.env.PUBLIC_URL || "").replace(/\/$/, ""),

  internalApiKey: process.env.INTERNAL_API_KEY || "",

  openai: {
    apiKey: required("OPENAI_API_KEY", process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || "gpt-4o",
  },

  vapi: {
    apiKey: required("VAPI_API_KEY", process.env.VAPI_API_KEY),
    phoneNumberId: required("VAPI_PHONE_NUMBER_ID", process.env.VAPI_PHONE_NUMBER_ID),
    voiceProvider: process.env.VAPI_VOICE_PROVIDER || "11labs",
    voiceId: process.env.VAPI_VOICE_ID || "burt",
    baseUrl: "https://api.vapi.ai",
  },

  agentmail: {
    apiKey: required("AGENTMAIL_API_KEY", process.env.AGENTMAIL_API_KEY),
    defaultInboxId: process.env.AGENTMAIL_DEFAULT_INBOX_ID || "",
    baseUrl: "https://api.agentmail.to/v0",
  },

  agentphone: {
    apiKey: process.env.AGENTPHONE_API_KEY || "",
    agentId: process.env.AGENTPHONE_AGENT_ID || "",
    numberId: process.env.AGENTPHONE_NUMBER_ID || "",
    webhookSecret: process.env.AGENTPHONE_WEBHOOK_SECRET || "",
    voice: process.env.AGENTPHONE_VOICE || "Polly.Amy",
    baseUrl: "https://api.agentphone.ai/v1",
  },

  // The single preset person we call when an urgent email comes in.
  presetUser: {
    name: process.env.USER_NAME || "",
    phoneNumber: process.env.USER_PHONE || "",
  },
};

export function webhookUrl() {
  if (!config.publicUrl) {
    console.warn("[config] PUBLIC_URL not set — Vapi will not be able to reach the tool webhook.");
  }
  return `${config.publicUrl}/api/vapi/webhook`;
}
