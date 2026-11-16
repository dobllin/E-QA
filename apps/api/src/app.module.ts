import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard, RolesGuard } from './common/auth';
import { DbModule } from './db/db.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SantriModule } from './santri/santri.module';
import { CardsModule } from './cards/cards.module';
import { WalletModule } from './wallet/wallet.module';
import { PosModule } from './pos/pos.module';
import { BillingModule } from './billing/billing.module';
import { PortalModule } from './portal/portal.module';
import { ReportsModule } from './reports/reports.module';
import { TopupsModule } from './topups/topups.module';
import { FeesModule } from './fees/fees.module';
import { SchoolModule } from './school/school.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AttendanceModule } from './attendance/attendance.module';
import { RemindersModule } from './reminders/reminders.module';
import { ImportModule } from './import/import.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 300) }]),
    DbModule, AuthModule, UsersModule, SantriModule, CardsModule, WalletModule, PosModule, BillingModule, PortalModule, ReportsModule, TopupsModule, FeesModule, SchoolModule, NotificationsModule, AttendanceModule, RemindersModule, ImportModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
