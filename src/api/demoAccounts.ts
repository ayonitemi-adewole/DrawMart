import type { DemoAccount } from './types'

/** One password for every demo account. */
export const DEMO_PASSWORD = 'drawmart-demo'

/**
 * Test accounts. The mock always has these. On Supabase,
 * private.seed_test_accounts() creates the buyer and store ones (test mode
 * only, see supabase/migrations/…_test_data_reset.sql); the admin only exists
 * on a local database (supabase/seed-local-accounts.sql).
 *
 * `mockId` is the user id (buyers) or store id (stores) on the mock;
 * `uuid` is the auth user id on Supabase. Keep both lists in step.
 */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { email: 'buyer@drawmart.test', password: DEMO_PASSWORD, role: 'buyer', name: 'Ada Okafor', mockId: 'u-me' },
  { email: 'chidi@drawmart.test', password: DEMO_PASSWORD, role: 'buyer', name: 'Chidi Eze', mockId: 'u-chidi' },
  { email: 'ngozi@drawmart.test', password: DEMO_PASSWORD, role: 'buyer', name: 'Ngozi Bello', mockId: 'u-ngozi' },
  { email: 'emeka@drawmart.test', password: DEMO_PASSWORD, role: 'buyer', name: 'Emeka Nwosu', mockId: 'u-emeka' },
  { email: 'funke@drawmart.test', password: DEMO_PASSWORD, role: 'buyer', name: 'Funke Ade', mockId: 'u-funke' },
  // A buyer who passed the ID check and sells their own items (Sell tab).
  { email: 'seller@drawmart.test', password: DEMO_PASSWORD, role: 'buyer', name: 'Tolu Adebayo', mockId: 'u-tolu', note: 'ID-verified seller' },
  { email: 'store@drawmart.test', password: DEMO_PASSWORD, role: 'store', name: 'Ikeja Partner Store', mockId: 'm-ikeja' },
  { email: 'lekki@drawmart.test', password: DEMO_PASSWORD, role: 'store', name: 'Lekki Partner Store', mockId: 'm-lekki' },
  { email: 'surulere@drawmart.test', password: DEMO_PASSWORD, role: 'store', name: 'Surulere Partner Store', mockId: 'm-surulere' },
  { email: 'yaba@drawmart.test', password: DEMO_PASSWORD, role: 'store', name: 'Yaba Partner Store', mockId: 'm-yaba' },
  { email: 'vi@drawmart.test', password: DEMO_PASSWORD, role: 'store', name: 'Victoria Island Partner Dealer', mockId: 'm-vi' },
  { email: 'admin@drawmart.test', password: DEMO_PASSWORD, role: 'admin', name: 'DrawMart Admin', mockId: 'u-admin' },
]
