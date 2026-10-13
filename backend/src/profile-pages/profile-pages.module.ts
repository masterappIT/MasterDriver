import { Module } from '@nestjs/common';
import { MyProfilePageController, PublicProfilePageController } from './profile-pages.controllers';
import { ProfilePagesService } from './profile-pages.service';

@Module({
  controllers: [MyProfilePageController, PublicProfilePageController],
  providers: [ProfilePagesService],
  exports: [ProfilePagesService],
})
export class ProfilePagesModule {}
