/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'mock' (default) or 'supabase'. */
  readonly VITE_BACKEND?: 'mock' | 'supabase'
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** 'false' once real money moves. Must match app_settings.test_mode. */
  readonly VITE_TEST_MODE?: string
  /** Flutterwave public key (FLWPUBK_TEST-… in test mode). Unset: instant test top-ups. */
  readonly VITE_FLUTTERWAVE_PUBLIC_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
