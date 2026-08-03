export interface InboundWhatsAppMessage {
  from: string;
  text: string;
  whatsappMessageId: string;
}

// Meta's webhook posts the same endpoint both real inbound messages (value.messages) and
// delivery-status callbacks (value.statuses) — only the former is a message this bot should
// act on. Returns null for anything else (status callbacks, non-text message types, or a
// malformed body) so the controller can safely no-op rather than error.
export function extractInboundMessage(payload: unknown): InboundWhatsAppMessage | null {
  const body = payload as any;
  const messages = body?.entry?.[0]?.changes?.[0]?.value?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }

  const message = messages[0];
  if (message?.type !== 'text' || typeof message?.text?.body !== 'string') {
    return null;
  }
  if (typeof message.from !== 'string' || typeof message.id !== 'string') {
    return null;
  }

  return { from: message.from, text: message.text.body, whatsappMessageId: message.id };
}
