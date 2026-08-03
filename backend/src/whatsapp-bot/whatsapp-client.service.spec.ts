import { WhatsAppClientService } from './whatsapp-client.service';

describe('WhatsAppClientService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'test-access-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-number-id';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends a text message and returns the whatsapp message id', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.abc123' }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const service = new WhatsAppClientService();
    const result = await service.sendTextMessage('+254700000001', 'hello there');

    expect(result).toEqual({ whatsappMessageId: 'wamid.abc123' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v20.0/test-phone-number-id/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-access-token' }),
      }),
    );
    const callBody = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(callBody).toEqual({
      messaging_product: 'whatsapp',
      to: '+254700000001',
      type: 'text',
      text: { body: 'hello there' },
    });
  });

  it('throws when the Meta API responds with a non-ok status', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid token"}',
    }) as unknown as typeof fetch;

    const service = new WhatsAppClientService();
    await expect(service.sendTextMessage('+254700000001', 'hello')).rejects.toThrow(
      'WhatsApp API send failed with status 401',
    );
  });

  it('throws when the response is missing a message id', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [] }),
    }) as unknown as typeof fetch;

    const service = new WhatsAppClientService();
    await expect(service.sendTextMessage('+254700000001', 'hello')).rejects.toThrow(
      'WhatsApp API response missing message id',
    );
  });
});
