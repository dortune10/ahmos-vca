import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { extractInboundMessage } from './extract-inbound-message';

@Injectable()
export class WhatsAppSenderThrottlerGuard extends ThrottlerGuard {
  // Reuse extractInboundMessage so the guard and the controller can never disagree about
  // which sender a payload belongs to.
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const inbound = extractInboundMessage(req.body);
    if (inbound?.from) {
      return `wa:${inbound.from.replace(/[^0-9]/g, '')}`;
    }
    return `ip:${req.ip ?? 'unknown'}`;
  }
}
