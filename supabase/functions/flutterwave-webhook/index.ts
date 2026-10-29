// Flutterwave calls this when a payment settles, including bank transfers that
// arrive after the buyer has left. Set its URL and secret hash in the
// Flutterwave dashboard (Settings → Webhooks); see docs/supabase-setup.md.
import { sameSecret, webhookTxRef } from '../_shared/flutterwave.ts'
import { json, paymentKind, paymentOwner, serviceClient, settlePayment } from '../_shared/deposits.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const hash = Deno.env.get('FLW_WEBHOOK_HASH') ?? ''
  if (!sameSecret(req.headers.get('verif-hash') ?? '', hash)) return json({ error: 'Unauthorized' }, 401)

  // The body only tells us which tx_ref to look at; settlePayment asks Flutterwave for the facts.
  const txRef = webhookTxRef(await req.json().catch(() => null))
  if (!txRef || !paymentKind(txRef)) return json({ ignored: true }) // not a DrawMart top-up or boost

  const db = serviceClient()
  if (!(await paymentOwner(db, txRef))) return json({ ignored: true })

  try {
    return json({ status: await settlePayment(db, txRef) })
  } catch (e) {
    console.error('flutterwave-webhook', txRef, e)
    return json({ error: 'Try again' }, 500) // Flutterwave retries failed webhooks
  }
})
