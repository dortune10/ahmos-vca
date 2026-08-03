import { Injectable, Logger } from '@nestjs/common';

export interface WhatsAppSendResult {
  whatsappMessageId: string;
}

@Injectable()
export class WhatsAppClientService {
  private readonly logger = new Logger(WhatsAppClientService.name);

  async sendTextMessage(toPhone: string, body: string): Promise<WhatsAppSendResult> {
    const apiVersion = process.env.WHATSAPP_API_VERSION ?? 'v20.0';
    const baseUrl = process.env.WHATSAPP_API_BASE_URL ?? 'https://graph.facebook.com';
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? '';
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN ?? '';

    const url = `${baseUrl}/${apiVersion}/${phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'text',
        text: { body },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error(`WhatsApp send failed (${response.status}): ${errorBody}`);
      throw new Error(`WhatsApp API send failed with status ${response.status}`);
    }

    const json = (await response.json()) as { messages?: Array<{ id: string }> };
    const whatsappMessageId = json.messages?.[0]?.id;
    if (!whatsappMessageId) {
      throw new Error('WhatsApp API response missing message id');
    }
    return { whatsappMessageId };
  }
}
