import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '../../common/services/logger.service';
import type { Database } from '../../types/supabase';

@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = createLogger('SupabaseService');

  // Service-role client: bypasses RLS. Server-side use only, never expose to the dashboard/browser.
  private _admin: SupabaseClient<Database> | null = null;

  // Anon-key client: subject to RLS. Mirrors what the dashboard uses; kept here for backend
  // code paths that need to act as an anonymous/RLS-scoped user rather than the service role.
  private _anon: SupabaseClient<Database> | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const url = this.configService.get<string>('supabase.url');
    const serviceRoleKey = this.configService.get<string>('supabase.serviceRoleKey');
    const anonKey = this.configService.get<string>('supabase.anonKey');

    if (!url || !serviceRoleKey) {
      this.logger.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured, admin client disabled');
    } else {
      this._admin = createClient<Database>(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }

    if (!url || !anonKey) {
      this.logger.warn('SUPABASE_URL / SUPABASE_ANON_KEY not configured, anon client disabled');
    } else {
      this._anon = createClient<Database>(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }
  }

  get admin(): SupabaseClient<Database> {
    if (!this._admin) {
      throw new Error('Supabase admin client is not configured (missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)');
    }
    return this._admin;
  }

  get anon(): SupabaseClient<Database> {
    if (!this._anon) {
      throw new Error('Supabase anon client is not configured (missing SUPABASE_URL/SUPABASE_ANON_KEY)');
    }
    return this._anon;
  }
}
