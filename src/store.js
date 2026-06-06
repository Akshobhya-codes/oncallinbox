// In-memory map of Vapi callId -> the email context that triggered the call.
// During the call, the send_reply tool webhook looks the context up by callId so
// it knows who to reply to and which thread to thread into. For a hackathon this
// is plenty; swap for Redis/DB if you need persistence across restarts.

const callContexts = new Map();

export function saveCallContext(callId, context) {
  callContexts.set(callId, { ...context, createdAt: Date.now() });
}

export function getCallContext(callId) {
  return callContexts.get(callId) || null;
}

export function deleteCallContext(callId) {
  callContexts.delete(callId);
}

export function allContexts() {
  return [...callContexts.entries()].map(([callId, ctx]) => ({ callId, ...ctx }));
}

// One-shot send guard: atomically claim the right to send a reply for this call.
// Returns true exactly once per call (the first claimer); false thereafter, so
// overlapping confirmation turns can't double-send.
export function claimReplySend(callId) {
  const ctx = callContexts.get(callId);
  if (!ctx || ctx.replySent) return false;
  ctx.replySent = true;
  return true;
}

// Release the claim if the send failed, so the user can retry.
export function releaseReplySend(callId) {
  const ctx = callContexts.get(callId);
  if (ctx) ctx.replySent = false;
}
