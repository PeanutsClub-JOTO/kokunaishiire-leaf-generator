/**
 * Supabase クライアント (Server / Browser 両対応)
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// サーバサイド用クライアント（Service Role Key使用）
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false },
  });
}

// クライアントサイド用クライアント（Anon Key使用）
export function createBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient<Database>(url, key);
}
