import type { DemoAccount } from './types'

/**
 * One account per app. The mock always has these; a local Supabase gets them
 * from supabase/seed-local-accounts.sql. Never on a hosted project.
 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { email: 'buyer@drawmart.test', password: 'drawmart-demo', role: 'buyer' },
  { email: 'store@drawmart.test', password: 'drawmart-demo', role: 'store' },
  { email: 'admin@drawmart.test', password: 'drawmart-demo', role: 'admin' },
]
