import { createClient } from '@supabase/supabase-js'

// Variáveis de ambiente definidas no arquivo .env
// VITE_SUPABASE_URL=https://xxxx.supabase.co
// VITE_SUPABASE_ANON_KEY=eyJhb...

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const isSupabaseConfigured =
  !!SUPABASE_URL && !!SUPABASE_ANON_KEY &&
  SUPABASE_URL !== 'https://seu-projeto.supabase.co'

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null
