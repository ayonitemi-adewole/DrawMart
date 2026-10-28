import { createClient } from '@supabase/supabase-js'
import { createMockApi } from './mock'
import { createSupabaseApi } from './supabase'
import type { DrawMartApi } from './types'

/**
 * The one place the app chooses its backend, from VITE_BACKEND in .env.local:
 *   mock      in-browser demo data (default)
 *   supabase  your Supabase project (needs VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY)
 */
function createApi(): DrawMartApi {
  const env = import.meta.env
  if (env.VITE_BACKEND !== 'supabase') return createMockApi()

  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    throw new Error('VITE_BACKEND=supabase needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local. See docs/supabase-setup.md.')
  }
  return createSupabaseApi(createClient(url, key), { testMode: env.VITE_TEST_MODE !== 'false' })
}

export const api: DrawMartApi = createApi()

export * from './types'
