import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

// @Global: the admin/anon clients are needed across unrelated feature modules
// (mirrors the AuthModule/StorageModule pattern already used for cross-cutting services).
@Global()
@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SupabaseModule {}
