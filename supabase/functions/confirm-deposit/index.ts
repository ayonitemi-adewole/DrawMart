// POST { txRef } from the app after Flutterwave's checkout closes.
// Checks the payment with Flutterwave and credits the wallet if it went through.
import { corsHeaders, json, serviceClient, settleDeposit } from '../_shared/deposits.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const db = serviceClient()
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
  const { data: auth } = await db.auth.getUser(token)
  if (!auth.user) return json({ error: 'Sign in first.' }, 401)

  const { txRef } = (await req.json().catch(() => ({}))) as { txRef?: unknown }
  if (typeof txRef !== 'string') return json({ error: 'txRef is required.' }, 400)

  // Only the buyer who started a deposit may ask about it.
  const { data: deposit } = await db.from('deposits').select('user_id').eq('tx_ref', txRef).maybeSingle()
  if (!deposit || deposit.user_id !== auth.user.id) return json({ error: 'No such top-up.' }, 404)

  try {
    return json({ status: await settleDeposit(db, txRef) })
  } catch (e) {
    console.error('confirm-deposit', txRef, e)
    return json({ error: 'We couldn’t reach Flutterwave. Your top-up will be checked again shortly.' }, 502)
  }
})
