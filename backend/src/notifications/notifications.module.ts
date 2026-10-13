import { Global, Module } from '@nestjs/common';
import { NotificationSettingsController, NotificationsController } from './notifications.controller';
import { NotificationStreams } from './notification-streams';
import { NotificationsService } from './notifications.service';

/** Global: orders, bookings and 客服 all send notifications. */
@Global()
@Module({
  controllers: [NotificationsController, NotificationSettingsController],
  providers: [NotificationsService, NotificationStreams],
  exports: [NotificationsService],
})
export class NotificationsModule {}
