import { Module } from '@nestjs/common';
import { MyGroupInvitesController, PublicGroupInvitesController } from './group-invites.controller';
import { GroupInvitesService } from './group-invites.service';

@Module({
  controllers: [MyGroupInvitesController, PublicGroupInvitesController],
  providers: [GroupInvitesService],
  exports: [GroupInvitesService],
})
export class GroupsModule {}
