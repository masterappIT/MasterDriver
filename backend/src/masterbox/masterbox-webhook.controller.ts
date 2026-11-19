import { Controller, Headers, HttpCode, HttpStatus, Inject, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { apiError } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config';
import { MasterBoxWebhook, verifyMasterBoxSignature, type MasterBoxEvent } from './masterbox-webhook';

/**
 * Where MasterBox sends its events: https://<site>/api/support/masterbox-webhook, set up in MasterBox's
 * 「API 與 Webhook」 for message.created and message.read of our key. Closed (404) without MASTERBOX_WEBHOOK_SECRET.
 * Any 2xx within 10 seconds is taken as received; anything else is sent again later.
 */
@Controller('support')
export class MasterBoxWebhookController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MasterBoxWebhook) private readonly webhook: MasterBoxWebhook,
  ) {}

  @Post('masterbox-webhook')
  @HttpCode(HttpStatus.OK)
  async receive(@Req() request: RawBodyRequest<Request>, @Headers('x-masterbox-signature') signature: string | undefined) {
    const secret = this.config.masterboxWebhookSecret;
    if (!secret) throw apiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    const raw = request.rawBody;
    if (!raw || !verifyMasterBoxSignature(raw, signature, secret)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'MASTERBOX_SIGNATURE_INVALID', 'The signature does not match');
    }
    let event: MasterBoxEvent;
    try {
      event = JSON.parse(raw.toString('utf8')) as MasterBoxEvent;
    } catch {
      throw apiError(HttpStatus.BAD_REQUEST, 'MASTERBOX_EVENT_INVALID', 'The event is not JSON');
    }
    // Done before answering (a few database reads): if it fails, MasterBox sends the event again.
    await this.webhook.handle(event);
    return { received: true };
  }
}
