import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma.module';
import { ProfileController } from './profile/profile.controller';

@Module({
  imports: [PrismaModule, AuthModule, OrdersModule],
  controllers: [HealthController, ProfileController],
})
export class AppModule {}
