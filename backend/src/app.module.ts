import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './common/supabase/supabase.module';
import { AuthModule } from './common/auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { FacilityModule } from './facility/facility.module';
import { IdentityModule } from './identity/identity.module';
import { UsersModule } from './users/users.module';
import { TasksModule } from './tasks/tasks.module';
import { EpisodeModule } from './episode/episode.module';
import { RiskModule } from './risk/risk.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    SupabaseModule,
    AuthModule,
    AuditModule,
    FacilityModule,
    IdentityModule,
    UsersModule,
    TasksModule,
    EpisodeModule,
    RiskModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
