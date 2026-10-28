// Shared by confirm-deposit and flutterwave-webhook (Deno, Supabase Edge Functions).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { isTestKey, verifyPayment, type PaymentStatus } from './flutterwave.ts'

export type DepositStatus = PaymentStatus | 'cancelled'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

/** Service-role client. Only ever used inside Edge Functions, never in the app. */
export const serviceClient = (): SupabaseClient =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

/**
 * Asks Flutterwave about a deposit and records the answer. Safe to call any
 * number of times: complete_deposit credits the wallet only once.
 */
export async function settleDeposit(db: SupabaseClient, txRef: string): Promise<DepositStatus> {
  const secretKey = Deno.env.get('FLW_SECRET_KEY')
  if (!secretKey) throw new Error('FLW_SECRET_KEY is not set. See docs/supabase-setup.md.')

  // Test keys while test mode is on, live keys only once it's off: never mix test payments and real money.
  const { data: settings, error } = await db.from('app_settings').select('test_mode').single()
  if (error) throw error
  if (settings.test_mode !== isTestKey(secretKey)) {
    throw new Error(settings.test_mode ? 'Test mode is on: use a FLWSECK_TEST- key.' : 'Test mode is off: use a live Flutterwave key.')
  }

  const payment = await verifyPayment(txRef, secretKey)
  if (payment.status === 'pending') {
    const { data } = await db.from('deposits').select('status').eq('tx_ref', txRef).maybeSingle()
    return (data?.status as DepositStatus | undefined) ?? 'pending'
  }
  const { data: status, error: rpcError } = await db.rpc('complete_deposit', {
    p_tx_ref: txRef,
    p_status: payment.status,
    p_amount_kobo: payment.amountKobo,
    p_currency: payment.currency,
    p_provider_ref: payment.providerRef,
  })
  if (rpcError) throw rpcError
  return status as DepositStatus
}
