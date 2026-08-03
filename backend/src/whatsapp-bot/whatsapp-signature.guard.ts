import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

@Injectable()
export class WhatsAppSignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) {
      throw new ForbiddenException('WhatsApp app secret not configured');
    }

    const signatureHeader: string | undefined = request.headers['x-hub-signature-256'];
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      throw new ForbiddenException('Missing or malformed WhatsApp signature header');
    }

    const rawBody: Buffer = request.rawBody ?? Buffer.from('');
    const expectedHex = createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const providedHex = signatureHeader.slice('sha256='.length);

    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const providedBuf = Buffer.from(providedHex, 'hex');
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
      throw new ForbiddenException('Invalid WhatsApp signature');
    }

    return true;
  }
}
