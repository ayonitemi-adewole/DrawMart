// POST { txRef } from the app after Flutterwave's checkout closes, for a wallet
// top-up (DM-) or a paid boost (BST-). Checks the payment with Flutterwave and
// credits the wallet or starts the boost if it went through.
import { corsHeaders, json, paymentOwner, serviceClient, settlePayment } from '../_shared/deposits.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const db = serviceClient()
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
  const { data: auth } = await db.auth.getUser(token)
  if (!auth.user) return json({ error: 'Sign in first.' }, 401)

  const { txRef } = (await req.json().catch(() => ({}))) as { txRef?: unknown }
  if (typeof txRef !== 'string') return json({ error: 'txRef is required.' }, 400)

  // Only the person who started a payment may ask about it.
  if ((await paymentOwner(db, txRef)) !== auth.user.id) return json({ error: 'No such payment.' }, 404)

  try {
    return json({ status: await settlePayment(db, txRef) })
  } catch (e) {
    console.error('confirm-deposit', txRef, e)
    return json({ error: 'We couldn’t reach Flutterwave. Your payment will be checked again shortly.' }, 502)
  }
})
