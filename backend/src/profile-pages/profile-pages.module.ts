import { Module } from '@nestjs/common';
import { MyProfilePageController, PassengerDriverPhotoController, PublicProfilePageController } from './profile-pages.controllers';
import { ProfilePagesService } from './profile-pages.service';

@Module({
  controllers: [MyProfilePageController, PublicProfilePageController, PassengerDriverPhotoController],
  providers: [ProfilePagesService],
  exports: [ProfilePagesService],
})
export class ProfilePagesModule {}
