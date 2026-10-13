import { Body, Controller, Delete, Get, HttpStatus, Inject, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { groupInviteCreateSchema, groupInviteUpdateSchema, type GroupInviteCreate, type GroupInviteUpdate } from '@masterdriver/shared';
import type { Response } from 'express';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { apiError } from '../common/errors';
import { ZodPipe } from '../common/zod-pipe';
import { GroupInvitesService } from './group-invites.service';

@Controller('me/group-invites')
@UseGuards(AuthGuard)
export class MyGroupInvitesController {
  constructor(@Inject(GroupInvitesService) private readonly invites: GroupInvitesService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.invites.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: SessionUser, @Body(new ZodPipe(groupInviteCreateSchema)) body: GroupInviteCreate) {
    return this.invites.create(user.id, body);
  }

  @Patch(':id')
  update(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new ZodPipe(groupInviteUpdateSchema)) body: GroupInviteUpdate) {
    return this.invites.update(user.id, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.invites.remove(user.id, id);
  }
}

@Controller('public/group-invites')
export class PublicGroupInvitesController {
  constructor(@Inject(GroupInvitesService) private readonly invites: GroupInvitesService) {}

  @Get(':id/qr')
  async qr(@Param('id') id: string, @Res() response: Response) {
    const image = await this.invites.qrImage(id);
    if (!image) throw apiError(HttpStatus.NOT_FOUND, 'GROUP_INVITE_NOT_FOUND', 'QR not available');
    response
      .set({
        'content-type': image.mime,
        // Short cache: a WeChat group QR expires, and the owner can replace it.
        'cache-control': 'public, max-age=300',
        'x-content-type-options': 'nosniff',
      })
      .send(image.bytes);
  }
}
