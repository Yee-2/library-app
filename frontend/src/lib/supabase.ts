// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.error('[Supabase] 缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY 环境变量')
}

export const supabase = createClient(url ?? '', anonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

// 公共 Edge Function 端点
export const FUNCTIONS_URL = `${url}/functions/v1`
