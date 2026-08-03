import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { WhatsAppSignatureGuard } from './whatsapp-signature.guard';

function contextWithRequest(headers: Record<string, string>, rawBody: Buffer): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, rawBody }),
    }),
  } as unknown as ExecutionContext;
}

describe('WhatsAppSignatureGuard', () => {
  const appSecret = 'test-app-secret';

  beforeEach(() => {
    process.env.WHATSAPP_APP_SECRET = appSecret;
  });

  it('allows a request with a valid signature', () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const signature = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const guard = new WhatsAppSignatureGuard();

    const result = guard.canActivate(
      contextWithRequest({ 'x-hub-signature-256': `sha256=${signature}` }, rawBody),
    );

    expect(result).toBe(true);
  });

  it('rejects a request with a tampered body', () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const signature = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const guard = new WhatsAppSignatureGuard();
    const tamperedBody = Buffer.from(JSON.stringify({ hello: 'tampered' }));

    expect(() =>
      guard.canActivate(contextWithRequest({ 'x-hub-signature-256': `sha256=${signature}` }, tamperedBody)),
    ).toThrow(ForbiddenException);
  });

  it('rejects a request with no signature header', () => {
    const guard = new WhatsAppSignatureGuard();
    expect(() => guard.canActivate(contextWithRequest({}, Buffer.from('{}')))).toThrow(
      ForbiddenException,
    );
  });
});
