import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
  adminSupportHandledSchema,
  adminSupportOpenSchema,
  adminSupportQuerySchema,
  supportMediaQuerySchema,
  supportTextSchema,
  supportThreadQuerySchema,
  type AdminSupportHandled,
  type AdminSupportOpen,
  type AdminSupportQuery,
  type SupportMediaQuery,
  type SupportText,
  type SupportThreadQuery,
} from '@masterdriver/shared';
import type { Request, Response } from 'express';
import type { AdminUser } from '../admin/admin-auth.service';
import { AdminGuard, AdminRoles, CurrentAdmin } from '../admin/admin.guard';
import { CurrentUser, OptionalAuthGuard } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { apiError } from '../common/errors';
import { ZodPipe } from '../common/zod-pipe';
import { UPLOAD_MAX_BYTES } from './media-file';
import { readLimited } from './read-body';
import { SupportService, type Participant } from './support.service';

/** A guest sends the token of their conversation with every request. */
export const SUPPORT_GUEST_HEADER = 'x-md-support-guest';

async function uploadedBytes(request: Request) {
  const bytes = await readLimited(request, UPLOAD_MAX_BYTES);
  if (!bytes) throw apiError(HttpStatus.PAYLOAD_TOO_LARGE, 'SUPPORT_MEDIA_TOO_LARGE', 'The file is too large');
  return bytes;
}

/** Files are private to the conversation: never cached by anything shared, never run as a page. */
function sendMedia(response: Response, media: { mime: string; bytes: Buffer }) {
  response
    .set({
      'content-type': media.mime,
      'content-disposition': 'inline',
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    })
    .send(media.bytes);
}

/** 客服 for signed-in users and for guests. */
@Controller('support')
@UseGuards(OptionalAuthGuard)
export class SupportController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  /** Signed in: the user's own conversation. Otherwise the guest conversation the token belongs to. */
  private async participant(user: SessionUser | undefined, request: Request): Promise<Participant> {
    if (user) return { type: 'USER', userId: user.id };
    const token = request.headers[SUPPORT_GUEST_HEADER];
    const guest = typeof token === 'string' && token ? await this.support.guestParticipant(token) : null;
    if (!guest) throw apiError(HttpStatus.UNAUTHORIZED, 'SUPPORT_GUEST_REQUIRED', 'Start a guest conversation first');
    return guest;
  }

  @Post('guest')
  openGuest(@Req() request: Request) {
    return this.support.openGuest(request.ip);
  }

  @Get('thread')
  async thread(
    @CurrentUser() user: SessionUser | undefined,
    @Req() request: Request,
    @Query(new ZodPipe(supportThreadQuerySchema)) query: SupportThreadQuery,
  ) {
    return this.support.thread(await this.participant(user, request), query);
  }

  @Get('unread')
  async unread(@CurrentUser() user: SessionUser | undefined, @Req() request: Request) {
    return this.support.unread(await this.participant(user, request));
  }

  @Post('messages')
  async sendText(
    @CurrentUser() user: SessionUser | undefined,
    @Req() request: Request,
    @Body(new ZodPipe(supportTextSchema)) body: SupportText,
  ) {
    return this.support.sendText(await this.participant(user, request), body);
  }

  /** The request body is the picture or video itself; what it is comes from its bytes. */
  @Post('media')
  async sendMedia(
    @CurrentUser() user: SessionUser | undefined,
    @Req() request: Request,
    @Query(new ZodPipe(supportMediaQuerySchema)) query: SupportMediaQuery,
  ) {
    const participant = await this.participant(user, request);
    return this.support.sendMedia(participant, await uploadedBytes(request), query.clientMessageId);
  }

  @Get('media/:id')
  async media(@CurrentUser() user: SessionUser | undefined, @Req() request: Request, @Param('id') id: string, @Res() response: Response) {
    sendMedia(response, await this.support.media(await this.participant(user, request), id));
  }
}

/** The shared inbox in the platform admin. 銷售 has no access to conversations. */
@Controller('admin/support')
@UseGuards(AdminGuard)
@AdminRoles('SUPER_ADMIN', 'OPERATOR')
export class AdminSupportController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  @Get('conversations')
  list(@Query(new ZodPipe(adminSupportQuerySchema)) query: AdminSupportQuery) {
    return this.support.list(query);
  }

  @Post('conversations')
  @HttpCode(200)
  open(@Body(new ZodPipe(adminSupportOpenSchema)) body: AdminSupportOpen, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    return this.support.openForUser(body.userId, admin, request.ip);
  }

  @Get('conversations/:id')
  thread(@Param('id') id: string, @Query(new ZodPipe(supportThreadQuerySchema)) query: SupportThreadQuery) {
    return this.support.staffThread(id, query);
  }

  @Post('conversations/:id/messages')
  sendText(
    @Param('id') id: string,
    @Body(new ZodPipe(supportTextSchema)) body: SupportText,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    return this.support.staffSendText(id, admin, body, request.ip);
  }

  @Post('conversations/:id/handled')
  @HttpCode(200)
  markHandled(
    @Param('id') id: string,
    @Body(new ZodPipe(adminSupportHandledSchema)) body: AdminSupportHandled,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    return this.support.staffMarkHandled(id, admin, body.seq, request.ip);
  }

  @Post('conversations/:id/media')
  async sendMedia(
    @Param('id') id: string,
    @Query(new ZodPipe(supportMediaQuerySchema)) query: SupportMediaQuery,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    return this.support.staffSendMedia(id, admin, await uploadedBytes(request), query.clientMessageId, request.ip);
  }

  @Get('media/:id')
  async media(@Param('id') id: string, @Res() response: Response) {
    sendMedia(response, await this.support.staffMedia(id));
  }

  /** Deleting a conversation cannot be undone, so it is the 超級管理員's alone. */
  @Delete('conversations/:id')
  @AdminRoles('SUPER_ADMIN')
  remove(@Param('id') id: string, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    return this.support.staffDelete(id, admin, request.ip);
  }
}
