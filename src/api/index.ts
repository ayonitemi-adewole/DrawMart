import { createClient } from '@supabase/supabase-js'
import { createMockApi } from './mock'
import { isFlutterwaveTestKey } from '@/lib/flutterwave'
import { createSupabaseApi } from './supabase'
import type { DrawMartApi } from './types'

/**
 * The one place the app chooses its backend, from VITE_BACKEND in .env.local:
 *   mock      in-browser demo data (default)
 *   supabase  your Supabase project (needs VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY;
 *             add VITE_FLUTTERWAVE_PUBLIC_KEY for card/bank top-ups)
 */
function createApi(): DrawMartApi {
  const env = import.meta.env
  if (env.VITE_BACKEND !== 'supabase') return createMockApi()

  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) {
    throw new Error('VITE_BACKEND=supabase needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local. See docs/supabase-setup.md.')
  }
  const testMode = env.VITE_TEST_MODE !== 'false'
  // Optional: without it, top-ups are instant test money.
  const flutterwavePublicKey = env.VITE_FLUTTERWAVE_PUBLIC_KEY || undefined
  if (flutterwavePublicKey && isFlutterwaveTestKey(flutterwavePublicKey) !== testMode) {
    throw new Error(
      testMode
        ? 'VITE_TEST_MODE is on, so VITE_FLUTTERWAVE_PUBLIC_KEY must be a test key (FLWPUBK_TEST-…). No real money until the licence is granted.'
        : 'VITE_TEST_MODE is off, so VITE_FLUTTERWAVE_PUBLIC_KEY must be a live key.',
    )
  }
  return createSupabaseApi(createClient(url, key), { testMode, flutterwavePublicKey })
}

export const api: DrawMartApi = createApi()

export * from './types'
