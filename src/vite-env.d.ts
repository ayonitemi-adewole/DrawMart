/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'mock' (default) or 'supabase'. */
  readonly VITE_BACKEND?: 'mock' | 'supabase'
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** 'false' once real money moves. Must match app_settings.test_mode. */
  readonly VITE_TEST_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
