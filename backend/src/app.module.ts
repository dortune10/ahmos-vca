import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SupabaseModule } from './common/supabase/supabase.module';
import { AuthModule } from './common/auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { FacilityModule } from './facility/facility.module';
import { IdentityModule } from './identity/identity.module';

@Module({
  imports: [SupabaseModule, AuthModule, AuditModule, FacilityModule, IdentityModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
