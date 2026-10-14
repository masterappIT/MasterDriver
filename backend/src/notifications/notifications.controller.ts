import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import {
  notificationReadSchema,
  notificationSettingsSchema,
  type NotificationRead,
  type NotificationSettings,
} from '@masterdriver/shared';
import type { Request, Response } from 'express';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { ZodPipe } from '../common/zod-pipe';
import { NotificationStreams } from './notification-streams';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(NotificationStreams) private readonly streams: NotificationStreams,
  ) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.notifications.list(user.id);
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  read(@CurrentUser() user: SessionUser, @Body(new ZodPipe(notificationReadSchema)) body: NotificationRead) {
    return this.notifications.markRead(user.id, body);
  }

  /**
   * Server-sent events while the page is open: only "changed", after which the page reads the
   * list. Read with fetch so the sign-in token goes in the header, never in the address.
   */
  @Get('stream')
  async stream(@CurrentUser() user: SessionUser, @Req() request: Request, @Res() response: Response) {
    this.streams.open(user.id, request, response);
    await this.notifications.revealDue(user.id);
    await this.notifications.unclaimedDue(user.id);
  }
}

@Controller('me/notification-settings')
@UseGuards(AuthGuard)
export class NotificationSettingsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  get(@CurrentUser() user: SessionUser) {
    return this.notifications.settings(user.id);
  }

  @Put()
  save(@CurrentUser() user: SessionUser, @Body(new ZodPipe(notificationSettingsSchema)) body: NotificationSettings) {
    return this.notifications.saveSettings(user.id, body);
  }
}
