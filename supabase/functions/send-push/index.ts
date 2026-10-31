// Sends queued phone notifications. A database job calls this every minute
// (private.send_pending_push); see docs/supabase-setup.md. Deploy with --no-verify-jwt:
// it checks its own secret, and the queue it reads holds nothing a caller can influence.
import { json, serviceClient } from '../_shared/deposits.ts'
import { sameSecret } from '../_shared/flutterwave.ts'
import { sendWebPush, type PushTarget, type VapidKeys } from '../_shared/webpush.ts'

interface QueuedPush {
  id: string
  title: string
  body: string
  url: string
  tag: string
  subscriptions: PushTarget[]
}

const BATCH = 50
const MAX_BATCHES = 5

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (!sameSecret(req.headers.get('x-push-secret') ?? '', Deno.env.get('PUSH_CRON_SECRET') ?? '')) return json({ error: 'Unauthorized' }, 401)

  const vapid: VapidKeys = {
    publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
    privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
    subject: Deno.env.get('VAPID_SUBJECT') ?? '',
  }
  if (!vapid.publicKey || !vapid.privateKey || !vapid.subject) return json({ error: 'VAPID secrets are not set' }, 500)

  const db = serviceClient()
  let sent = 0
  let failed = 0

  for (let i = 0; i < MAX_BATCHES; i++) {
    const { data, error } = await db.rpc('claim_push_batch', { p_limit: BATCH })
    if (error) {
      console.error('send-push claim', error.message)
      return json({ error: 'Try again' }, 500)
    }
    const batch = (data ?? []) as QueuedPush[]
    if (!batch.length) break

    await Promise.all(
      batch.map(async (push) => {
        const payload = JSON.stringify({ title: push.title, body: push.body, url: push.url, tag: push.tag })
        const outcomes = await Promise.all(push.subscriptions.map((s) => sendWebPush(s, payload, vapid).catch(() => 'failed' as const)))
        const dead = push.subscriptions.filter((_, n) => outcomes[n] === 'gone').map((s) => s.endpoint)
        // Retried later only if nothing got through and something could still.
        const done = outcomes.includes('sent') || dead.length === push.subscriptions.length
        if (done) sent += 1
        else failed += 1
        const finished = await db.rpc('finish_push', { p_id: push.id, p_done: done, p_dead_endpoints: dead })
        if (finished.error) console.error('send-push finish', finished.error.message)
      }),
    )
    if (batch.length < BATCH) break
  }

  return json({ sent, failed })
})
