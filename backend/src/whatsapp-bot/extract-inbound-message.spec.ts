import { extractInboundMessage } from './extract-inbound-message';

describe('extractInboundMessage', () => {
  it('extracts from, text, and whatsappMessageId from a real-shaped text message payload', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-id',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '15550001111', phone_number_id: 'pnid' },
                contacts: [{ profile: { name: 'Amina' }, wa_id: '254700000001' }],
                messages: [
                  {
                    from: '254700000001',
                    id: 'wamid.HBgLMjU0NzAw',
                    timestamp: '1690000000',
                    text: { body: 'When is my next appointment?' },
                    type: 'text',
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const result = extractInboundMessage(payload);

    expect(result).toEqual({
      from: '254700000001',
      text: 'When is my next appointment?',
      whatsappMessageId: 'wamid.HBgLMjU0NzAw',
    });
  });

  it('returns null for a delivery-status callback payload (no messages field)', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-id',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '15550001111', phone_number_id: 'pnid' },
                statuses: [{ id: 'wamid.abc', status: 'delivered', timestamp: '1690000000' }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    expect(extractInboundMessage(payload)).toBeNull();
  });

  it('returns null for a non-text message (e.g. image)', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ from: '254700000001', id: 'wamid.img', type: 'image', image: { id: 'media-id' } }],
              },
            },
          ],
        },
      ],
    };

    expect(extractInboundMessage(payload)).toBeNull();
  });

  it('returns null for a malformed/empty payload', () => {
    expect(extractInboundMessage({})).toBeNull();
    expect(extractInboundMessage(null)).toBeNull();
    expect(extractInboundMessage(undefined)).toBeNull();
  });
});
