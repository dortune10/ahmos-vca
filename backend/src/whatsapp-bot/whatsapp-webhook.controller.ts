import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { timingSafeEqual } from 'crypto';

// Constant-time string compare, so the verify token can't be recovered a byte at a time.
function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

@Controller('whatsapp/webhook')
export class WhatsAppWebhookController {
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ): void {
    if (mode === 'subscribe' && safeEqual(token, process.env.WHATSAPP_VERIFY_TOKEN)) {
      // .type('text/plain') is required, not cosmetic: hub.challenge is attacker-controlled
      // and Express defaults res.send(string) to text/html, which would make this a reflected
      // XSS on the API origin for anyone who guesses the verify token.
      res.status(200).type('text/plain').send(String(challenge));
      return;
    }
    res.status(403).type('text/plain').send('Webhook verification failed');
  }
}
