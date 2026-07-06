// Supabase client for the OpenWA dashboard.
// Uses ONLY the anon/publishable key — RLS-scoped, safe for the browser.
// Never import the service-role key here; that key lives server-side only (src/modules/supabase).
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../src/types/supabase';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not configured; supabase client disabled');
}

export const supabase = createClient<Database>(supabaseUrl ?? '', supabaseAnonKey ?? '');
